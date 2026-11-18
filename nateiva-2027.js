/* ============================================================================
   NATEIVA — Campagne 2027 · Fresh Start
   ----------------------------------------------------------------------------
   Ce module ajoute au dashboard :
   1. Capture GPS (Global Positioning System) silencieuse + télémétrie de saisie
      (durée de remplissage, horodatage d'ouverture du formulaire) attachées à
      chaque suivi via les métadonnées de notes.
   2. La Campagne 2027 : repartir à zéro, avec la liste prioritaire des écoles
      prospectées les années précédentes qui n'ont PAS signé (à appeler /
      visiter en premier).
   3. Attribution exclusive 2027 : le premier membre qui saisit une note sur une
      école (ancienne ou nouvelle) en devient propriétaire pour la campagne.
      Tout autre membre doit envoyer une demande au Super Admin.
   4. Pilotage Super Admin : KPI (Key Performance Indicators — indicateurs clés
      de performance) comparés à la campagne précédente, à période équivalente,
      avec Insights IA (Intelligence Artificielle) générés depuis les données.
   5. Rapport Score de Confiance : détection des saisies suspectes (GPS
      manquant, écoles multiples au même endroit, déplacements impossibles,
      remplissage trop rapide, téléphones dupliqués, rafales) — classé par
      prospecteur.
   Le module se greffe sur les fonctions globales existantes d'index.html sans
   les réécrire : il enveloppe (wrap) validateSchoolSelectionForUser,
   updateSchoolOwnershipNotice et applyBackendBootstrap.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__NATEIVA_C27_INIT__) return;
  window.__NATEIVA_C27_INIT__ = true;

  /* ======================= 0. CONFIGURATION ============================== */
  var NC = window.NATEIVA_CONFIG || {};
  var CFG = {
    YEAR: Number(NC.C27_YEAR || 2027),
    START_ISO: String(NC.C27_START || '2027-01-01T00:00:00'),
    PREV_LABEL: 'Campagne 2026',
    CUR_LABEL: 'Campagne 2027',
    GPS: {
      timeoutMs: 20000,       // délai max pour obtenir une position
      maxFixAgeMs: 10 * 60e3, // une position de moins de 10 min est utilisable à la soumission
      goodAcc: 60,            // ≤ 60 m : vraie position GPS
      poorAcc: 250            // > 250 m : position réseau (antenne), peu fiable
    },
    TRUST: {
      // Seuils des signaux — chaque seuil est expliqué dans l'interface.
      clusterMeters: 150,     // 2 écoles différentes saisies à < 150 m l'une de l'autre
      clusterWindowMin: 60,   // ... dans une fenêtre de 60 minutes
      travelKmh: 70,          // vitesse impossible entre 2 saisies géolocalisées (> 70 km/h)
      travelMinKm: 2,         // ... seulement si la distance dépasse 2 km
      fastVisitSecs: 60,      // visite terrain saisie en < 60 s = suspect
      fastCallSecs: 20,       // appel saisi en < 20 s = suspect
      burstCount: 6,          // plus de 6 saisies...
      burstWindowMin: 30,     // ... en 30 minutes = rafale (saisie de bureau probable)
      dupPhoneSchools: 3,     // même téléphone sur ≥ 3 écoles différentes
      nightStart: 22, nightEnd: 5, // saisies nocturnes (signal faible)
      // Pondérations du score (sur 100) — le score démarre à 100 et chaque
      // signal retire (poids × part des saisies concernées) points.
      weights: { noGps: 25, lowAcc: 10, cluster: 30, travel: 30, fast: 20, burst: 15, dupPhone: 20, night: 5 }
    }
  };
  var START_MS = Date.parse(CFG.START_ISO);

  function tsMs(v) { var m = Date.parse(String(v || '')); return isFinite(m) ? m : null; }
  function inCampaign(ts) { var m = tsMs(ts); return m != null && m >= START_MS; }
  function campaignStarted() { return Date.now() >= START_MS; }
  function kmBetween(a, b) { // distance de Haversine en kilomètres
    var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function _esc(v) { return (typeof esc === 'function') ? esc(v) : String(v == null ? '' : v); }
  function _attr(v) { return (typeof attrEsc === 'function') ? attrEsc(v) : _esc(v); }
  function _fmt(v) { return (typeof fmt === 'function') ? fmt(v) : String(Math.round(v || 0)); }
  function _me() { return (window.currentUser && window.currentUser.fullName) || ''; }
  function _toast(msg, bad) { if (typeof showToast === 'function') showToast(msg, !!bad); }
  function dayDiff(a, b) { return Math.max(0, Math.round((a - b) / 86400000)); }

  /* ======================= 1. CAPTURE GPS SILENCIEUSE ===================== */
  // On capture, on ne bloque jamais : une saisie sans GPS reste possible mais
  // est marquée « sans position » et pèse sur le score de confiance.
  var GEO = { fixes: [], lastError: '', formOpenedAt: null, lastCaptureAt: 0 };

  function geoCapture(reason) {
    if (!navigator.geolocation) { GEO.lastError = 'unsupported'; return; }
    var now = Date.now();
    if (now - GEO.lastCaptureAt < 20000) return; // pas plus d'une demande / 20 s
    GEO.lastCaptureAt = now;
    try {
      navigator.geolocation.getCurrentPosition(function (pos) {
        var c = pos.coords || {};
        GEO.fixes.push({
          lat: c.latitude, lng: c.longitude,
          acc: Math.round(c.accuracy || 0),
          at: pos.timestamp || Date.now(),
          mock: (pos && pos.coords && pos.coords.isMock === true) ? 1 : 0,
          why: reason || ''
        });
        if (GEO.fixes.length > 30) GEO.fixes = GEO.fixes.slice(-30);
        GEO.lastError = '';
      }, function (err) {
        GEO.lastError = err && err.code === 1 ? 'denied' : (err && err.code === 3 ? 'timeout' : 'unavailable');
      }, { enableHighAccuracy: true, timeout: CFG.GPS.timeoutMs, maximumAge: 15000 });
    } catch (e) { GEO.lastError = 'error'; }
  }

  function bestRecentFix() {
    var now = Date.now(), best = null;
    for (var i = 0; i < GEO.fixes.length; i++) {
      var f = GEO.fixes[i];
      if (now - f.at > CFG.GPS.maxFixAgeMs) continue;
      if (!best || f.acc < best.acc) best = f;
    }
    return best;
  }

  function markFormOpened() {
    GEO.formOpenedAt = new Date().toISOString();
    geoCapture('form-open');
  }

  // Injection des métadonnées GPS + télémétrie dans la saisie. Appelée par
  // submitFollowup() juste après la construction de questionnaireMeta.
  // En mode édition, la position d'ORIGINE est préservée (on ne réécrit jamais
  // le GPS d'une visite passée avec la position du bureau au moment de l'édition).
  window.nateivaApplyGeoMeta = function (meta, editableExisting) {
    try {
      if (editableExisting && typeof splitFollowupNotes === 'function') {
        var stored = splitFollowupNotes(editableExisting.Notes).meta || {};
        ['gpsLat', 'gpsLng', 'gpsAcc', 'gpsAt', 'gpsMock', 'gpsStatus', 'formOpenedAt', 'fillSecs'].forEach(function (k) {
          if (stored[k] != null && String(stored[k]) !== '') meta[k] = String(stored[k]);
        });
        meta.lastEditAt = new Date().toISOString();
        return meta;
      }
      var fix = bestRecentFix();
      if (fix) {
        meta.gpsLat = String(fix.lat);
        meta.gpsLng = String(fix.lng);
        meta.gpsAcc = String(fix.acc);                       // précision en mètres
        meta.gpsAt = new Date(fix.at).toISOString();         // heure de la position
        if (fix.mock) meta.gpsMock = '1';                    // position simulée détectée
        meta.gpsStatus = fix.acc <= CFG.GPS.goodAcc ? 'gps' : (fix.acc <= CFG.GPS.poorAcc ? 'network' : 'coarse');
      } else {
        meta.gpsStatus = 'none' + (GEO.lastError ? ':' + GEO.lastError : '');
      }
      if (GEO.formOpenedAt) {
        meta.formOpenedAt = GEO.formOpenedAt;
        var secs = Math.round((Date.now() - Date.parse(GEO.formOpenedAt)) / 1000);
        if (isFinite(secs) && secs >= 0) meta.fillSecs = String(secs); // durée de remplissage en secondes
      }
      GEO.formOpenedAt = null; // réinitialisé pour la prochaine saisie
      geoCapture('post-submit');
    } catch (e) { /* la saisie ne doit jamais échouer à cause du GPS */ }
    return meta;
  };

  function readEntryGeo(item) {
    if (!item || typeof splitFollowupNotes !== 'function') return null;
    var m = splitFollowupNotes(item.Notes).meta || {};
    var lat = parseFloat(m.gpsLat), lng = parseFloat(m.gpsLng);
    return {
      has: isFinite(lat) && isFinite(lng),
      lat: lat, lng: lng,
      acc: parseFloat(m.gpsAcc) || null,
      mock: m.gpsMock === '1',
      status: m.gpsStatus || '',
      fillSecs: m.fillSecs != null && m.fillSecs !== '' ? parseFloat(m.fillSecs) : null
    };
  }

  /* ======================= 2. ATTRIBUTIONS 2027 (CLAIMS) ================== */
  var LS_KEYS = {
    serverClaims: 'nateiva_c27_server_claims',
    requests: 'nateiva_c27_requests',
    pendingReqs: 'nateiva_c27_pending_requests',
    tab: 'nateiva_c27_tab',
    trustScope: 'nateiva_c27_trust_scope'
  };
  function lsGet(k, fb) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  var c27State = {
    serverClaims: lsGet(LS_KEYS.serverClaims, null), // [{schoolKey, schoolName, owner, ownerUsername, firstAt}]
    requests: lsGet(LS_KEYS.requests, []),
    pendingReqs: lsGet(LS_KEYS.pendingReqs, [])
  };

  // Le serveur est la source de vérité (les Experts ne voient que leurs propres
  // suivis) ; on fusionne avec le calcul local pour couvrir le mode hors-ligne.
  function getClaimsMap() {
    var map = {};
    (c27State.serverClaims || []).forEach(function (c) {
      if (c && c.schoolKey) map[c.schoolKey] = { owner: c.owner, ownerUsername: c.ownerUsername || '', firstAt: c.firstAt, schoolName: c.schoolName, src: 'server' };
    });
    var fups = (typeof getAllFollowups === 'function') ? getAllFollowups() : [];
    fups.forEach(function (f) {
      if (!f || !inCampaign(f.Timestamp)) return;
      var k = schoolKey(f.SchoolName); if (!k) return;
      var cur = map[k];
      var t = tsMs(f.Timestamp) || 0;
      if (!cur || (tsMs(cur.firstAt) || Infinity) > t) {
        map[k] = { owner: canonicalPersonName(f.Expert), ownerUsername: '', firstAt: f.Timestamp, schoolName: f.SchoolName, src: cur ? cur.src : 'local' };
      }
    });
    return map;
  }
  function getClaim(schoolName) {
    var k = schoolKey(schoolName); if (!k) return null;
    return getClaimsMap()[k] || null;
  }
  function myApprovedRequest(schoolName) {
    var k = schoolKey(schoolName), meU = (window.currentUser && window.currentUser.username || '').toLowerCase();
    return (c27State.requests || []).some(function (r) {
      return r && r.status === 'approved' && r.schoolKey === k &&
        String(r.requestedByUsername || '').toLowerCase() === meU;
    });
  }
  function myPendingRequest(schoolName) {
    var k = schoolKey(schoolName), meU = (window.currentUser && window.currentUser.username || '').toLowerCase();
    return (c27State.requests || []).concat(c27State.pendingReqs || []).some(function (r) {
      return r && (r.status === 'pending' || r._local) && r.schoolKey === k &&
        String(r.requestedByUsername || '').toLowerCase() === meU;
    });
  }

  /* --- Règle d'attribution 2027 : enveloppe de validateSchoolSelectionForUser --- */
  var _origValidate = window.validateSchoolSelectionForUser;
  window.validateSchoolSelectionForUser = function (schoolName) {
    // Avant le 1er janvier 2027, les anciennes règles s'appliquent telles quelles.
    if (!campaignStarted()) return _origValidate ? _origValidate(schoolName) : { ok: true, level: 'ok', message: '' };
    var trimmed = String(schoolName || '').trim();
    if (!trimmed) return { ok: true, level: 'ok', message: '' };
    var claim = getClaim(trimmed);
    var me = _me();
    if (!claim) {
      return { ok: true, level: 'ok', c27: true, message: '🚀 Campagne ' + CFG.YEAR + ' — nouveau départ : votre première saisie vous attribue cette école.' };
    }
    if (samePerson(claim.owner, me)) {
      return { ok: true, level: 'ok', c27: true, message: '👑 École de votre portefeuille ' + CFG.YEAR + ' (attribuée le ' + new Date(tsMs(claim.firstAt) || Date.now()).toLocaleDateString('fr-FR') + ').' };
    }
    if (myApprovedRequest(trimmed)) {
      return { ok: true, level: 'warn', c27: true, message: '✅ Accès accordé par le Super Admin — école attribuée à ' + claim.owner + ', vous êtes autorisé(e) à la suivre.' };
    }
    if (typeof isSuperAdmin === 'function' && isSuperAdmin(window.currentUser)) {
      return { ok: true, level: 'warn', c27: true, message: '👑 École attribuée à ' + claim.owner + ' pour ' + CFG.YEAR + ' — votre rôle Super Admin vous permet de poursuivre.' };
    }
    return {
      ok: false, level: 'error', c27: true, c27Locked: true, lockedOwner: claim.owner, lockedSchool: trimmed,
      message: '🔒 École déjà attribuée à ' + claim.owner + ' pour la campagne ' + CFG.YEAR + '. ' +
        (myPendingRequest(trimmed) ? 'Votre demande d\'attribution est en attente de décision du Super Admin.' : 'Envoyez une demande d\'attribution au Super Admin pour pouvoir la suivre.')
    };
  };

  // Enveloppe de la notice du formulaire : ajoute le bouton « Demander l'attribution ».
  var _origNotice = window.updateSchoolOwnershipNotice;
  window.updateSchoolOwnershipNotice = function () {
    var result = _origNotice ? _origNotice() : { ok: true };
    try {
      var notice = document.getElementById('fuSchoolNotice');
      if (notice && result && result.c27Locked && !myPendingRequest(result.lockedSchool)) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'c27-ask-btn';
        btn.textContent = '🙋 Demander l\'attribution au Super Admin';
        btn.onclick = function () { requestClaim(result.lockedSchool); };
        notice.appendChild(document.createElement('br'));
        notice.appendChild(btn);
      }
    } catch (e) { }
    return result;
  };

  /* --- Demandes d'attribution : API + repli hors-ligne --- */
  function requestClaim(schoolName) {
    var name = String(schoolName || '').trim();
    if (!name || !window.currentUser) return;
    var claim = getClaim(name);
    var payload = {
      schoolName: name, campaignYear: CFG.YEAR,
      message: 'Demande via dashboard — école attribuée à ' + (claim ? claim.owner : '?')
    };
    var localReq = {
      _local: true, schoolKey: schoolKey(name), schoolName: name, status: 'pending',
      requestedByUsername: window.currentUser.username, requestedByFullName: _me(),
      currentOwnerFullName: claim ? claim.owner : '', createdAt: new Date().toISOString()
    };
    if (typeof backendRequest === 'function' && typeof isBackendConfigured === 'function' && isBackendConfigured() && window.nateivaApiToken) {
      backendRequest('/api/claims/requests', { method: 'POST', body: payload }).then(function (res) {
        if (res && res.success && res.request) {
          c27State.requests = (c27State.requests || []).filter(function (r) { return r.id !== res.request.id; }).concat([normalizeRequest(res.request)]);
          lsSet(LS_KEYS.requests, c27State.requests);
          _toast('Demande envoyée au Super Admin ✓');
        } else {
          queueLocalRequest(localReq);
        }
        repaint();
      }).catch(function () { queueLocalRequest(localReq); repaint(); });
    } else {
      queueLocalRequest(localReq);
      repaint();
    }
  }
  function queueLocalRequest(req) {
    var exists = (c27State.pendingReqs || []).some(function (r) { return r.schoolKey === req.schoolKey && r.requestedByUsername === req.requestedByUsername; });
    if (!exists) {
      c27State.pendingReqs = (c27State.pendingReqs || []).concat([req]);
      lsSet(LS_KEYS.pendingReqs, c27State.pendingReqs);
    }
    _toast('Demande enregistrée sur cet appareil — envoi au prochain passage en ligne ⏳');
  }
  function flushPendingRequests() {
    if (!(c27State.pendingReqs || []).length) return;
    if (!(typeof isBackendConfigured === 'function' && isBackendConfigured() && window.nateivaApiToken)) return;
    var queue = c27State.pendingReqs.slice();
    c27State.pendingReqs = [];
    lsSet(LS_KEYS.pendingReqs, []);
    queue.forEach(function (req) {
      backendRequest('/api/claims/requests', { method: 'POST', body: { schoolName: req.schoolName, campaignYear: CFG.YEAR, message: 'Demande (synchronisation différée)' } })
        .then(function (res) {
          if (res && res.success && res.request) {
            c27State.requests = (c27State.requests || []).concat([normalizeRequest(res.request)]);
            lsSet(LS_KEYS.requests, c27State.requests);
            repaint();
          } else { queueLocalRequest(req); }
        }).catch(function () { queueLocalRequest(req); });
    });
  }
  function normalizeRequest(r) {
    return {
      id: r.id, schoolKey: r.schoolKey || schoolKey(r.schoolName), schoolName: r.schoolName,
      requestedByUsername: r.requestedByUsername, requestedByFullName: r.requestedByFullName,
      currentOwnerFullName: r.currentOwnerFullName || '', status: r.status || 'pending',
      decidedByUsername: r.decidedByUsername || '', decisionNote: r.decisionNote || '',
      createdAt: r.createdAt || '', decidedAt: r.decidedAt || ''
    };
  }
  function decideRequest(id, decision) {
    backendRequest('/api/claims/requests/' + encodeURIComponent(id) + '/decision', { method: 'POST', body: { decision: decision } })
      .then(function (res) {
        if (res && res.success && res.request) {
          c27State.requests = (c27State.requests || []).map(function (r) { return r.id === res.request.id ? normalizeRequest(res.request) : r; });
          lsSet(LS_KEYS.requests, c27State.requests);
          _toast(decision === 'approved' ? 'Demande approuvée ✓' : 'Demande refusée');
          repaint();
        } else { _toast((res && res.error) || 'Décision impossible — vérifiez la connexion', true); }
      }).catch(function () { _toast('Décision impossible — vérifiez la connexion', true); });
  }

  // Récupération de l'état serveur à chaque bootstrap (login / resynchronisation).
  var _origBootstrap = window.applyBackendBootstrap;
  window.applyBackendBootstrap = function (payload) {
    if (_origBootstrap) _origBootstrap(payload);
    try {
      if (payload && Array.isArray(payload.campaignClaims)) {
        c27State.serverClaims = payload.campaignClaims;
        lsSet(LS_KEYS.serverClaims, c27State.serverClaims);
      }
      if (payload && Array.isArray(payload.claimRequests)) {
        c27State.requests = payload.claimRequests.map(normalizeRequest);
        lsSet(LS_KEYS.requests, c27State.requests);
      }
      flushPendingRequests();
    } catch (e) { }
  };

  /* ======================= 3. LISTE PRIORITAIRE 2027 ====================== */
  // Écoles travaillées AVANT la campagne 2027 qui n'ont pas signé :
  // elles forment la liste « à appeler / visiter en premier ».
  var STAGE_ORDER = { chaud: 0, tiede: 1, nouveau: 2, froid: 3, perdu: 4 };
  var STAGE_LABEL = { chaud: '🔥 Chaud', tiede: '🌤 Tiède', nouveau: '✨ Nouveau', froid: '❄️ Froid', perdu: '⛔ Perdu' };

  function buildPriorityList() {
    if (typeof buildSchoolRecords !== 'function' || typeof getAllRawRows !== 'function' || typeof getAllFollowups !== 'function') return [];
    var raws = getAllRawRows(), fups = getAllFollowups();
    var recs = buildSchoolRecords(raws, fups);
    var claims = getClaimsMap();
    // Écoles ayant eu de l'activité AVANT la campagne 2027 : elles restent dans
    // la liste tant qu'elles n'ont pas signé, même après une saisie 2027 (la
    // pastille Attribution montre alors qui s'en occupe).
    var preKeys = {};
    raws.forEach(function (r) { var m = tsMs(r.t); if (m != null && m < START_MS) { var k = schoolKey(r.n); if (k) preKeys[k] = 1; } });
    fups.forEach(function (f) { var m = tsMs(f.Timestamp); if (m != null && m < START_MS) { var k = schoolKey(f.SchoolName); if (k) preKeys[k] = 1; } });
    return recs.filter(function (r) {
      if (!r || !r.schoolName) return false;
      if (r.stage === 'gagne') return false;                        // déjà signée → exclue
      var k = r.key || schoolKey(r.schoolName);
      return !!preKeys[k];                                          // travaillée avant 2027
    }).map(function (r) {
      var k = schoolKey(r.schoolName);
      var claim = claims[k] || null;
      var visitWanted = false;
      try { visitWanted = !!(r.callVisit === 'Oui' || (r.nextAction && /visite|visiter|passer|descente/i.test(r.nextAction))); } catch (e) { }
      return {
        key: k, name: r.schoolName, city: r.city || '', stage: r.stage || 'nouveau',
        rate: (r.rate == null ? null : r.rate), phone: r.phone || '', contact: r.contactName || '',
        lastExpert: r.expert || '', lastTouch: r.lastTouch || null,
        daysSince: r.lastTouch ? dayDiff(Date.now(), r.lastTouch.getTime()) : null,
        visitWanted: visitWanted,
        claim: claim
      };
    }).sort(function (a, b) {
      var c = (a.claim ? 1 : 0) - (b.claim ? 1 : 0); // non attribuées d'abord : à prendre
      if (c) return c;
      var s = (STAGE_ORDER[a.stage] != null ? STAGE_ORDER[a.stage] : 9) - (STAGE_ORDER[b.stage] != null ? STAGE_ORDER[b.stage] : 9);
      if (s) return s;
      var r = (b.rate || 0) - (a.rate || 0);
      if (r) return r;
      return (b.lastTouch ? b.lastTouch.getTime() : 0) - (a.lastTouch ? a.lastTouch.getTime() : 0);
    });
  }

  // Pré-remplit le formulaire de saisie avec l'école choisie dans la liste.
  window.c27StartEntry = function (name, city, contact, phone) {
    try {
      var ws = document.querySelector('.nav-btn[data-pane="suivi"]');
      if (ws) ws.click();
      setTimeout(function () {
        if (typeof activateSuiviPanel === 'function') activateSuiviPanel('add', { scroll: true });
        setTimeout(function () {
          var sel = document.getElementById('fuSchool');
          if (!sel) return;
          var matched = false;
          for (var i = 0; i < sel.options.length; i++) {
            if (schoolKey(sel.options[i].value) === schoolKey(name)) { sel.selectedIndex = i; matched = true; break; }
          }
          if (!matched) {
            for (var j = 0; j < sel.options.length; j++) { if (sel.options[j].value === '__other__') { sel.selectedIndex = j; break; } }
            var wrap = document.getElementById('fuSchoolCustomWrap'); if (wrap) wrap.style.display = '';
            var custom = document.getElementById('fuSchoolCustom'); if (custom) custom.value = name;
          }
          if (city) { var c = document.getElementById('fuCity'); if (c) c.value = city; }
          if (contact) { var ct = document.getElementById('fuContact'); if (ct && !ct.value) ct.value = contact; }
          if (phone) { var ph = document.getElementById('fuPhone'); if (ph && !ph.value) ph.value = phone; }
          if (typeof sel.onchange === 'function') sel.onchange();
          markFormOpened();
          if (typeof updateSchoolOwnershipNotice === 'function') updateSchoolOwnershipNotice();
        }, 120);
      }, 60);
    } catch (e) { }
  };
  window.c27RequestClaim = function (name) { requestClaim(name); };
  window.c27Decide = function (id, decision) { decideRequest(id, decision); };

  /* ======================= 4. MOTEUR SCORE DE CONFIANCE =================== */
  function computeTrust(scopeAll) {
    var fups = (typeof getAllFollowups === 'function') ? getAllFollowups() : [];
    var entries = fups.filter(function (f) {
      if (!f || !f.Timestamp || !f.Expert) return false;
      return scopeAll ? true : inCampaign(f.Timestamp);
    }).map(function (f) {
      var geo = readEntryGeo(f);
      return {
        id: f.ID || '', ts: tsMs(f.Timestamp), tsIso: f.Timestamp,
        expert: canonicalPersonName(f.Expert), school: f.SchoolName || '', key: schoolKey(f.SchoolName),
        type: f.FollowupType || '', phone: (typeof digitsOnly === 'function') ? digitsOnly(f.ContactPhone) : String(f.ContactPhone || ''),
        city: f.City || '', geo: geo, flags: []
      };
    }).filter(function (e) { return e.ts != null; });
    entries.sort(function (a, b) { return a.ts - b.ts; });

    var T = CFG.TRUST;
    // — Téléphones dupliqués (tous experts confondus)
    var phoneSchools = {};
    entries.forEach(function (e) {
      if (!e.phone || e.phone.length < 8) return;
      (phoneSchools[e.phone] = phoneSchools[e.phone] || new Set()).add(e.key);
    });
    // — Par expert : clusters, déplacements, rafales
    var byExpert = {};
    entries.forEach(function (e) { (byExpert[e.expert] = byExpert[e.expert] || []).push(e); });

    entries.forEach(function (e) {
      var isField = e.type === 'VISIT' || e.type === 'PROSPECTION';
      // GPS attendu uniquement pour les saisies de la campagne 2027 (le module
      // de capture n'existait pas avant) et pour les actions terrain.
      if (isField && inCampaign(e.tsIso)) {
        if (!e.geo || !e.geo.has) e.flags.push({ t: 'noGps', m: 'Visite terrain sans position GPS' });
        else if (e.geo.acc != null && e.geo.acc > T.clusterMeters) e.flags.push({ t: 'lowAcc', m: 'Précision GPS faible (' + Math.round(e.geo.acc) + ' m — position réseau)' });
        if (e.geo && e.geo.mock) e.flags.push({ t: 'travel', m: 'Position simulée détectée (mock location)' });
      }
      if (e.geo && e.geo.fillSecs != null) {
        if (isField && e.geo.fillSecs < T.fastVisitSecs) e.flags.push({ t: 'fast', m: 'Formulaire visite rempli en ' + Math.round(e.geo.fillSecs) + ' s (< ' + T.fastVisitSecs + ' s)' });
        else if (e.type === 'CALL' && e.geo.fillSecs < T.fastCallSecs) e.flags.push({ t: 'fast', m: 'Formulaire appel rempli en ' + Math.round(e.geo.fillSecs) + ' s (< ' + T.fastCallSecs + ' s)' });
      }
      if (e.phone && phoneSchools[e.phone] && phoneSchools[e.phone].size >= T.dupPhoneSchools) {
        e.flags.push({ t: 'dupPhone', m: 'Téléphone ' + e.phone + ' utilisé sur ' + phoneSchools[e.phone].size + ' écoles différentes' });
      }
      var h = new Date(e.ts).getHours();
      if (h >= T.nightStart || h < T.nightEnd) e.flags.push({ t: 'night', m: 'Saisie nocturne (' + h + 'h)' });
    });

    Object.keys(byExpert).forEach(function (name) {
      var list = byExpert[name];
      // Clusters : 2 écoles différentes à < clusterMeters dans la fenêtre
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!a.geo || !a.geo.has) continue;
        for (var j = i + 1; j < list.length; j++) {
          var b = list[j];
          if (!b.geo || !b.geo.has) continue;
          if (Math.abs(b.ts - a.ts) > T.clusterWindowMin * 60000) break;
          if (a.key === b.key) continue;
          var km = kmBetween({ lat: a.geo.lat, lng: a.geo.lng }, { lat: b.geo.lat, lng: b.geo.lng });
          if (km * 1000 <= T.clusterMeters) {
            var msg = '2 écoles différentes saisies au même endroit (' + Math.round(km * 1000) + ' m d\'écart, ' + Math.round(Math.abs(b.ts - a.ts) / 60000) + ' min)';
            a.flags.push({ t: 'cluster', m: msg + ' — avec « ' + b.school + ' »' });
            b.flags.push({ t: 'cluster', m: msg + ' — avec « ' + a.school + ' »' });
          }
        }
      }
      // Déplacement impossible : vitesse entre 2 saisies géolocalisées consécutives
      var prev = null;
      list.forEach(function (e) {
        if (!e.geo || !e.geo.has) return;
        if (prev) {
          var hours = (e.ts - prev.ts) / 3600000;
          if (hours > 0) {
            var km = kmBetween({ lat: prev.geo.lat, lng: prev.geo.lng }, { lat: e.geo.lat, lng: e.geo.lng });
            if (km >= T.travelMinKm && (km / hours) > T.travelKmh) {
              e.flags.push({ t: 'travel', m: 'Déplacement impossible : ' + km.toFixed(1) + ' km en ' + Math.round(hours * 60) + ' min (' + Math.round(km / hours) + ' km/h) depuis « ' + prev.school + ' »' });
            }
          }
        }
        prev = e;
      });
      // Rafales : > burstCount saisies en burstWindowMin
      for (var s = 0; s < list.length; s++) {
        var cnt = 1;
        for (var t2 = s + 1; t2 < list.length && list[t2].ts - list[s].ts <= T.burstWindowMin * 60000; t2++) cnt++;
        if (cnt > T.burstCount) {
          for (var u = s; u < s + cnt && u < list.length; u++) {
            if (!list[u].flags.some(function (fl) { return fl.t === 'burst'; })) {
              list[u].flags.push({ t: 'burst', m: cnt + ' saisies en ' + T.burstWindowMin + ' min (rafale — saisie de bureau probable)' });
            }
          }
        }
      }
    });

    // Agrégation par prospecteur → score sur 100.
    var W = T.weights;
    var report = Object.keys(byExpert).map(function (name) {
      var list = byExpert[name];
      var counts = { noGps: 0, lowAcc: 0, cluster: 0, travel: 0, fast: 0, burst: 0, dupPhone: 0, night: 0 };
      var flagged = 0;
      list.forEach(function (e) {
        if (e.flags.length) flagged++;
        var seen = {};
        e.flags.forEach(function (fl) { if (!seen[fl.t]) { counts[fl.t] = (counts[fl.t] || 0) + 1; seen[fl.t] = 1; } });
      });
      var n = list.length || 1;
      var score = 100;
      Object.keys(W).forEach(function (k) { score -= W[k] * ((counts[k] || 0) / n); });
      score = Math.max(0, Math.round(score));
      var gpsCovered = list.filter(function (e) { return (e.type === 'VISIT' || e.type === 'PROSPECTION') && inCampaign(e.tsIso); });
      var gpsOk = gpsCovered.filter(function (e) { return e.geo && e.geo.has; }).length;
      return {
        expert: name, entries: list.length, flagged: flagged, counts: counts, score: score,
        gpsRate: gpsCovered.length ? Math.round(100 * gpsOk / gpsCovered.length) : null,
        flaggedEntries: list.filter(function (e) { return e.flags.length; })
          .sort(function (a, b) { return b.flags.length - a.flags.length; }).slice(0, 40)
      };
    }).sort(function (a, b) { return b.score - a.score || b.entries - a.entries; });

    return { report: report, totalEntries: entries.length, scopeAll: scopeAll };
  }

  function scoreBadge(score) {
    var cls = score >= 85 ? 'c27-sc-good' : score >= 70 ? 'c27-sc-ok' : score >= 50 ? 'c27-sc-warn' : 'c27-sc-bad';
    var lab = score >= 85 ? 'Fiable' : score >= 70 ? 'Correct' : score >= 50 ? 'À surveiller' : 'Alerte';
    return '<span class="c27-score ' + cls + '"><b>' + score + '</b><i>/100 · ' + lab + '</i></span>';
  }

  /* ======================= 5. PILOTAGE — KPI YoY + INSIGHTS IA ============ */
  function computeYoY() {
    var fups = (typeof getAllFollowups === 'function') ? getAllFollowups() : [];
    var raws = (typeof getAllRawRows === 'function') ? getAllRawRows() : [];
    var prevFups = fups.filter(function (f) { return !inCampaign(f.Timestamp); });
    var curFups = fups.filter(function (f) { return inCampaign(f.Timestamp); });
    var prevRaws = raws.filter(function (r) { var m = tsMs(r.t); return m != null && m < START_MS; });
    var curRaws = raws.filter(function (r) { var m = tsMs(r.t); return m != null && m >= START_MS; });

    // Alignement « à période équivalente » : si la campagne 2027 a N jours
    // d'activité, on compare aux N premiers jours d'activité de la campagne
    // précédente (démarrée à sa première saisie).
    var prevStartMs = null;
    prevFups.concat(prevRaws.map(function (r) { return { Timestamp: r.t }; })).forEach(function (x) {
      var m = tsMs(x.Timestamp); if (m != null && (prevStartMs == null || m < prevStartMs)) prevStartMs = m;
    });
    var windowDays = campaignStarted() ? Math.max(1, dayDiff(Date.now(), START_MS)) : 0;
    var prevCutoff = prevStartMs != null ? prevStartMs + windowDays * 86400000 : null;
    var prevWinFups = prevCutoff ? prevFups.filter(function (f) { var m = tsMs(f.Timestamp); return m != null && m < prevCutoff; }) : prevFups;
    var prevWinRaws = prevCutoff ? prevRaws.filter(function (r) { var m = tsMs(r.t); return m != null && m < prevCutoff; }) : prevRaws;

    function metricsOf(rawsX, fupsX, winStart, winEnd) {
      var schools = new Set(), experts = new Set(), calls = 0, visits = 0, cost = 0;
      rawsX.forEach(function (r) { var k = schoolKey(r.n); if (k) schools.add(k); if (r.e) experts.add(canonicalPersonName(r.e)); });
      fupsX.forEach(function (f) {
        var k = schoolKey(f.SchoolName); if (k) schools.add(k);
        if (f.Expert) experts.add(canonicalPersonName(f.Expert));
        if (f.FollowupType === 'CALL') calls++;
        if (f.FollowupType === 'VISIT') visits++;
        cost += Number(f.Cost) || 0;
      });
      var recs = (typeof buildSchoolRecords === 'function') ? buildSchoolRecords(rawsX, fupsX) : [];
      var signed = recs.filter(function (r) {
        if (r.stage !== 'gagne') return false;
        if (!r.closedAt) return true;
        var m = r.closedAt.getTime();
        return (winStart == null || m >= winStart) && (winEnd == null || m < winEnd);
      });
      return {
        entries: rawsX.length + fupsX.length, schools: schools.size, experts: experts.size,
        calls: calls, visits: visits, cost: cost, signed: signed.length,
        conv: schools.size ? (100 * signed.length / schools.size) : 0,
        costPerSign: signed.length ? cost / signed.length : null
      };
    }
    var cur = metricsOf(curRaws, curFups, START_MS, null);
    var prevW = metricsOf(prevWinRaws, prevWinFups, prevStartMs, prevCutoff);
    var prevFull = metricsOf(prevRaws, prevFups, null, START_MS);
    return { cur: cur, prevW: prevW, prevFull: prevFull, windowDays: windowDays, prevStartMs: prevStartMs };
  }

  function deltaChip(cur, prev, goodUp, suffix) {
    if (prev == null || !isFinite(prev)) return '<span class="c27-delta c27-d-na">— réf. indisponible</span>';
    if (prev === 0) return cur > 0 ? '<span class="c27-delta c27-d-up">▲ nouveau</span>' : '<span class="c27-delta c27-d-na">=</span>';
    var pct = Math.round(100 * (cur - prev) / prev);
    var up = pct >= 0;
    var good = goodUp ? up : !up;
    return '<span class="c27-delta ' + (pct === 0 ? 'c27-d-na' : (good ? 'c27-d-up' : 'c27-d-down')) + '">' +
      (pct === 0 ? '=' : (up ? '▲ +' : '▼ ') + pct + '%') + (suffix || '') + '</span>';
  }

  function buildInsights(yoy, trust, priority) {
    var out = [];
    var cur = yoy.cur, prev = yoy.prevW;
    if (!campaignStarted()) {
      out.push({ icon: '🗓', sev: 'info', title: 'Campagne ' + CFG.YEAR + ' pas encore ouverte', text: 'Le pilotage comparatif s\'activera automatiquement le ' + new Date(START_MS).toLocaleDateString('fr-FR') + '. En attendant, la liste prioritaire ci-contre contient ' + _fmt(priority.length) + ' écoles non signées à rappeler dès l\'ouverture.' });
    } else {
      if (prev.entries > 0) {
        var pace = prev.entries ? Math.round(100 * cur.entries / prev.entries) : null;
        out.push({
          icon: pace >= 100 ? '🚀' : '🐢', sev: pace >= 100 ? 'good' : 'warn',
          title: pace >= 100 ? 'Rythme supérieur à ' + CFG.PREV_LABEL : 'Rythme en retrait vs ' + CFG.PREV_LABEL,
          text: 'À J+' + yoy.windowDays + ', la campagne compte ' + _fmt(cur.entries) + ' saisies contre ' + _fmt(prev.entries) + ' à période équivalente l\'an dernier (' + pace + '% du rythme). Calcul : saisies 2027 depuis le 1er janvier ÷ saisies de la campagne précédente sur ses ' + yoy.windowDays + ' premiers jours d\'activité.'
        });
      }
      if (cur.schools > 0 && yoy.windowDays >= 7) {
        var runRate = cur.signed / Math.max(1, yoy.windowDays);
        var proj = Math.round(runRate * 365);
        out.push({ icon: '📈', sev: 'info', title: 'Projection annuelle : ~' + _fmt(proj) + ' signatures', text: 'Calcul : ' + cur.signed + ' signature(s) en ' + yoy.windowDays + ' jours → ' + runRate.toFixed(2) + '/jour × 365. La campagne précédente avait signé ' + _fmt(yoy.prevFull.signed) + ' école(s) au total.' });
      }
      if (cur.calls + cur.visits > 0) {
        var ratio = cur.visits ? (cur.calls / cur.visits).toFixed(1) : '∞';
        out.push({ icon: '🔀', sev: 'info', title: ratio === '∞' || cur.visits === 0 ? 'Aucune visite terrain enregistrée' : ratio + ' appels pour 1 visite', text: 'La signature vient rarement sans visite : surveillez la conversion appel → visite. ' + _fmt(cur.calls) + ' appels · ' + _fmt(cur.visits) + ' visites sur la campagne.' });
      }
    }
    var hot = priority.filter(function (p) { return p.stage === 'chaud' && !p.claim; });
    if (hot.length) {
      out.push({ icon: '🔥', sev: 'good', title: hot.length + ' école(s) chaude(s) non attribuée(s)', text: 'Des écoles proches de signer l\'an dernier n\'ont encore aucun propriétaire ' + CFG.YEAR + ' : à attribuer en priorité — ' + hot.slice(0, 3).map(function (p) { return '« ' + p.name + ' »'; }).join(', ') + (hot.length > 3 ? '…' : '') + '.' });
    }
    var risky = (trust.report || []).filter(function (r) { return r.score < 70 && r.entries >= 5; });
    if (risky.length) {
      out.push({ icon: '🛡', sev: 'warn', title: 'Confiance : ' + risky.length + ' prospecteur(s) à vérifier', text: risky.map(function (r) { return r.expert + ' (' + r.score + '/100)'; }).join(' · ') + ' — détails dans l\'onglet Confiance. Un score < 70 signifie que plusieurs saisies présentent des signaux (GPS manquant, rafales, doublons…).' });
    }
    var pending = (c27State.requests || []).filter(function (r) { return r.status === 'pending'; });
    if (pending.length) {
      out.push({ icon: '🙋', sev: 'warn', title: pending.length + ' demande(s) d\'attribution en attente', text: 'Des membres attendent votre décision dans l\'onglet Attributions.' });
    }
    if (!out.length) out.push({ icon: '🤖', sev: 'info', title: 'Pas encore assez de données', text: 'Les insights se généreront automatiquement dès les premières saisies de la campagne.' });
    return out;
  }

  /* ======================= 6. INTERFACE — PANE « 2027 » =================== */
  var CSS = ''
    + '#p-c27{--c27-gold:#B08D2F;--c27-gold-soft:#F7F1E3;}'
    + '#p-c27 .c27-wrap{max-width:1180px;margin:0 auto;padding:8px 4px 64px}'
    + '#p-c27 .c27-hero{padding:34px 36px;border-radius:20px;background:linear-gradient(135deg,var(--g950),#2A2419 70%,#3B301A);color:#FAF7EF;position:relative;overflow:hidden;margin-bottom:22px}'
    + '#p-c27 .c27-hero:before{content:"";position:absolute;inset:0;background:radial-gradient(600px 220px at 85% -20%,rgba(176,141,47,.35),transparent 70%)}'
    + '#p-c27 .c27-hero .k{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#CBB46A;margin-bottom:10px}'
    + '#p-c27 .c27-hero h2{font-family:"Fraunces",serif;font-size:clamp(28px,4vw,44px);font-weight:600;letter-spacing:-.02em;margin:0 0 10px;line-height:1.05}'
    + '#p-c27 .c27-hero p{max-width:640px;font-size:14px;line-height:1.65;color:#D9D2C0;margin:0}'
    + '#p-c27 .c27-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 22px}'
    + '#p-c27 .c27-tab{border:1px solid var(--g200);background:var(--paper);border-radius:999px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;color:var(--g700);transition:all .18s}'
    + '#p-c27 .c27-tab:hover{border-color:var(--c27-gold);color:var(--g900)}'
    + '#p-c27 .c27-tab.act{background:var(--g900);color:#F4EBD6;border-color:var(--g900);box-shadow:0 6px 18px rgba(0,0,0,.14)}'
    + '#p-c27 .c27-card{background:var(--paper);border:1px solid var(--g200);border-radius:18px;padding:26px 28px;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,.03)}'
    + '#p-c27 .c27-card h3{font-family:"Fraunces",serif;font-size:21px;font-weight:600;margin:0 0 4px;letter-spacing:-.01em}'
    + '#p-c27 .c27-sub{font-size:12.5px;color:var(--g500);margin:0 0 18px;line-height:1.55}'
    + '#p-c27 .c27-klabel{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--c27-gold);margin-bottom:6px}'
    + '#p-c27 .c27-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin:6px 0 10px}'
    + '#p-c27 .c27-tile{border:1px solid var(--g200);border-radius:14px;padding:16px 18px;background:linear-gradient(180deg,var(--paper),var(--g50))}'
    + '#p-c27 .c27-tile .v{font-family:"Fraunces",serif;font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1.1}'
    + '#p-c27 .c27-tile .l{font-size:12px;color:var(--g500);margin-top:3px}'
    + '#p-c27 .c27-delta{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:11px;margin-top:8px;padding:3px 8px;border-radius:6px}'
    + '#p-c27 .c27-d-up{background:#ECFDF5;color:var(--green)}#p-c27 .c27-d-down{background:#FEF2F2;color:var(--red)}#p-c27 .c27-d-na{background:var(--g100);color:var(--g500)}'
    + '#p-c27 .c27-filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}'
    + '#p-c27 .c27-filters select,#p-c27 .c27-filters input{border:1px solid var(--g200);border-radius:10px;padding:9px 12px;font-size:13px;background:var(--paper);min-width:150px}'
    + '#p-c27 table.c27-tbl{width:100%;border-collapse:collapse;font-size:13px}'
    + '#p-c27 table.c27-tbl th{text-align:left;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--g500);padding:10px 12px;border-bottom:1px solid var(--g200);white-space:nowrap}'
    + '#p-c27 table.c27-tbl td{padding:12px;border-bottom:1px solid var(--g100);vertical-align:middle}'
    + '#p-c27 table.c27-tbl tr:hover td{background:var(--c27-gold-soft)}'
    + '#p-c27 .c27-school{font-weight:600;color:var(--g900)}'
    + '#p-c27 .c27-muted{color:var(--g500);font-size:12px}'
    + '#p-c27 .c27-chip{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}'
    + '#p-c27 .c27-chip.chaud{background:#FEF2F2;color:#B91C1C}#p-c27 .c27-chip.tiede{background:#FFF7ED;color:#C2410C}'
    + '#p-c27 .c27-chip.nouveau{background:#EFF6FF;color:#1D4ED8}#p-c27 .c27-chip.froid{background:var(--g100);color:var(--g600)}'
    + '#p-c27 .c27-chip.perdu{background:var(--g100);color:var(--g500);text-decoration:line-through}'
    + '#p-c27 .c27-chip.libre{background:#ECFDF5;color:var(--green)}'
    + '#p-c27 .c27-chip.pris{background:var(--c27-gold-soft);color:var(--c27-gold)}'
    + '#p-c27 .c27-chip.pend{background:#FFF7ED;color:#C2410C}#p-c27 .c27-chip.appr{background:#ECFDF5;color:var(--green)}#p-c27 .c27-chip.deni{background:#FEF2F2;color:var(--red)}'
    + '#p-c27 .c27-act{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--g200);background:var(--paper);border-radius:9px;padding:7px 11px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;color:var(--g800);margin:2px;transition:all .15s}'
    + '#p-c27 .c27-act:hover{border-color:var(--c27-gold);background:var(--c27-gold-soft)}'
    + '#p-c27 .c27-act.primary{background:var(--g900);color:#F4EBD6;border-color:var(--g900)}'
    + '#p-c27 .c27-act.primary:hover{background:var(--g800)}'
    + '.c27-ask-btn{margin-top:8px;border:1px solid #B08D2F;background:#F7F1E3;color:#7A5F1C;border-radius:9px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer}'
    + '#p-c27 .c27-ins{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px}'
    + '#p-c27 .c27-in{border:1px solid var(--g200);border-left:4px solid var(--g300);border-radius:14px;padding:16px 18px;background:var(--paper)}'
    + '#p-c27 .c27-in.good{border-left-color:var(--green)}#p-c27 .c27-in.warn{border-left-color:var(--saffron)}#p-c27 .c27-in.info{border-left-color:var(--c27-gold)}'
    + '#p-c27 .c27-in b{display:block;font-size:14px;margin-bottom:5px}'
    + '#p-c27 .c27-in span{font-size:12.5px;color:var(--g600);line-height:1.6}'
    + '#p-c27 .c27-score{display:inline-flex;align-items:baseline;gap:4px;padding:5px 12px;border-radius:999px;font-size:15px}'
    + '#p-c27 .c27-score i{font-style:normal;font-size:10.5px;opacity:.75}'
    + '#p-c27 .c27-sc-good{background:#ECFDF5;color:var(--green)}#p-c27 .c27-sc-ok{background:#F0FDF4;color:#4D7C0F}'
    + '#p-c27 .c27-sc-warn{background:#FFF7ED;color:#C2410C}#p-c27 .c27-sc-bad{background:#FEF2F2;color:var(--red)}'
    + '#p-c27 .c27-bar{height:7px;border-radius:99px;background:var(--g100);overflow:hidden;margin-top:6px}'
    + '#p-c27 .c27-bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#B08D2F,#D4AF37)}'
    + '#p-c27 details.c27-det{margin-top:8px}'
    + '#p-c27 details.c27-det summary{cursor:pointer;font-size:12px;color:var(--g500);font-weight:600}'
    + '#p-c27 .c27-flag{font-size:12px;padding:7px 10px;border-radius:9px;background:var(--g50);border:1px solid var(--g100);margin-top:6px;line-height:1.5}'
    + '#p-c27 .c27-empty{padding:44px 20px;text-align:center;color:var(--g400);font-size:13.5px}'
    + '#p-c27 .c27-note{font-size:11.5px;color:var(--g400);line-height:1.6;margin-top:14px;border-top:1px dashed var(--g200);padding-top:12px}'
    + '@media(max-width:720px){#p-c27 .c27-hero{padding:24px 20px}#p-c27 .c27-card{padding:18px 16px}#p-c27 .c27-wrap{padding-bottom:110px}}';

  function injectCss() {
    if (document.getElementById('c27-style')) return;
    var st = document.createElement('style');
    st.id = 'c27-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  var _filters = { city: '', stage: '', q: '', free: '' };

  function repaint() {
    var pane = document.getElementById('p-c27');
    if (pane && pane.classList.contains('act')) rC27();
    else if (window._paneDirty) window._paneDirty.c27 = true;
  }

  function currentTab() { return lsGet(LS_KEYS.tab, 'list'); }
  window.c27SetTab = function (t) { lsSet(LS_KEYS.tab, t); rC27(); };
  window.c27SetFilter = function (k, v) { _filters[k] = v; rC27(); };
  window.c27SetTrustScope = function (v) { lsSet(LS_KEYS.trustScope, v); rC27(); };

  function rC27() {
    injectCss();
    var el = document.getElementById('p-c27');
    if (!el) return;
    if (!window.currentUser) {
      el.innerHTML = '<div class="c27-wrap"><div class="c27-card c27-empty">Connectez-vous pour accéder à la Campagne ' + CFG.YEAR + '.</div></div>';
      return;
    }
    var admin = (typeof canSeeAllData === 'function') && canSeeAllData(window.currentUser);
    var superA = (typeof isSuperAdmin === 'function') && isSuperAdmin(window.currentUser);
    var tab = currentTab();
    if ((tab === 'pilot' || tab === 'trust') && !admin) tab = 'list';

    var priority = buildPriorityList();
    var claims = getClaimsMap();
    var myClaims = Object.keys(claims).map(function (k) { return Object.assign({ key: k }, claims[k]); })
      .filter(function (c) { return samePerson(c.owner, _me()); });

    var h = '<div class="c27-wrap">';
    h += '<div class="c27-hero"><div class="k">NATEIVA · Prospection — nouveau départ</div>'
      + '<h2>Campagne <span style="color:#D4AF37">' + CFG.YEAR + '</span></h2>'
      + '<p>Repartez de zéro, en commençant par les <b>' + _fmt(priority.length) + ' écoles</b> prospectées les années précédentes qui n\'ont pas signé. '
      + 'Première saisie ' + CFG.YEAR + ' sur une école = l\'école vous est attribuée pour la campagne. Position GPS (Global Positioning System) capturée automatiquement à chaque saisie.</p></div>';

    h += '<div class="c27-tabs">'
      + tabBtn('list', '📞 Liste prioritaire', tab)
      + tabBtn('claims', '👑 Attributions & demandes', tab)
      + (admin ? tabBtn('pilot', '📊 Pilotage & IA', tab) : '')
      + (admin ? tabBtn('trust', '🛡 Score de confiance', tab) : '')
      + '</div>';

    if (tab === 'list') h += renderPriorityTab(priority, admin);
    else if (tab === 'claims') h += renderClaimsTab(myClaims, superA, admin);
    else if (tab === 'pilot') h += renderPilotTab(priority);
    else if (tab === 'trust') h += renderTrustTab();

    h += '</div>';
    el.innerHTML = h;
  }
  window.rC27 = rC27;

  function tabBtn(key, label, act) {
    return '<button class="c27-tab' + (act === key ? ' act' : '') + '" onclick="c27SetTab(\'' + key + '\')">' + label + '</button>';
  }

  /* ---------- Onglet 1 : Liste prioritaire ---------- */
  function renderPriorityTab(priority, admin) {
    var cities = {};
    priority.forEach(function (p) { if (p.city) cities[p.city] = 1; });
    var list = priority.filter(function (p) {
      if (_filters.city && p.city !== _filters.city) return false;
      if (_filters.stage && p.stage !== _filters.stage) return false;
      if (_filters.free === 'libre' && p.claim) return false;
      if (_filters.free === 'pris' && !p.claim) return false;
      if (_filters.q && normalizeText(p.name).indexOf(normalizeText(_filters.q)) === -1) return false;
      return true;
    });
    var shown = list.slice(0, 250);
    var h = '<div class="c27-card">'
      + '<div class="c27-klabel">À appeler · à visiter en premier</div>'
      + '<h3>Écoles non signées des campagnes précédentes</h3>'
      + '<p class="c27-sub">Toutes les écoles travaillées avant le ' + new Date(START_MS).toLocaleDateString('fr-FR') + ' sans signature, classées des plus chaudes aux plus froides (puis par taux d\'intérêt et dernier contact). Saisir une note dessus en ' + CFG.YEAR + ' vous l\'attribue.</p>';
    h += '<div class="c27-filters">'
      + '<select onchange="c27SetFilter(\'city\',this.value)"><option value="">Toutes les villes</option>' + Object.keys(cities).sort().map(function (c) { return '<option' + (_filters.city === c ? ' selected' : '') + ' value="' + _attr(c) + '">' + _esc(typeof getCityLabel === 'function' ? getCityLabel(c) : c) + '</option>'; }).join('') + '</select>'
      + '<select onchange="c27SetFilter(\'stage\',this.value)"><option value="">Tous les statuts</option>' + Object.keys(STAGE_LABEL).map(function (s) { return '<option' + (_filters.stage === s ? ' selected' : '') + ' value="' + s + '">' + STAGE_LABEL[s] + '</option>'; }).join('') + '</select>'
      + '<select onchange="c27SetFilter(\'free\',this.value)"><option value="">Attribuées & libres</option><option value="libre"' + (_filters.free === 'libre' ? ' selected' : '') + '>🟢 Libres uniquement</option><option value="pris"' + (_filters.free === 'pris' ? ' selected' : '') + '>👑 Déjà attribuées</option></select>'
      + '<input type="search" placeholder="Rechercher une école…" value="' + _attr(_filters.q) + '" oninput="c27SetFilter(\'q\',this.value)">'
      + (admin ? '<button class="c27-act" onclick="c27ExportPriority()">⬇️ Export CSV</button>' : '')
      + '</div>';
    if (!shown.length) {
      h += '<div class="c27-empty">Aucune école ne correspond à ces filtres.</div>';
    } else {
      h += '<div style="overflow-x:auto"><table class="c27-tbl"><thead><tr>'
        + '<th>École</th><th>Ville</th><th>Pipeline</th><th>Dernier contact</th><th>Attribution ' + CFG.YEAR + '</th><th>Actions</th>'
        + '</tr></thead><tbody>';
      shown.forEach(function (p) {
        var claimCell = p.claim
          ? '<span class="c27-chip pris">👑 ' + _esc(p.claim.owner) + '</span>'
          : '<span class="c27-chip libre">🟢 Libre</span>';
        var mine = p.claim && samePerson(p.claim.owner, _me());
        var acts = '';
        if (p.phone && typeof phoneHref === 'function') acts += '<a class="c27-act" href="' + _attr(phoneHref(p.phone)) + '">📞 Appeler</a>';
        if (p.phone && typeof whatsappHref === 'function') acts += '<a class="c27-act" target="_blank" rel="noopener" href="' + _attr(whatsappHref(p.phone)) + '">💬</a>';
        if (!p.claim || mine) acts += '<button class="c27-act primary" onclick="c27StartEntry(' + jsArg(p.name) + ',' + jsArg(p.city) + ',' + jsArg(p.contact) + ',' + jsArg(p.phone) + ')">✍️ Saisir</button>';
        else if (!myPendingRequest(p.name)) acts += '<button class="c27-act" onclick="c27RequestClaim(' + jsArg(p.name) + ')">🙋 Demander</button>';
        else acts += '<span class="c27-chip pend">⏳ Demande envoyée</span>';
        h += '<tr><td><div class="c27-school">' + _esc(p.name) + '</div>'
          + '<div class="c27-muted">' + _esc(p.contact || '') + (p.phone ? ' · ' + _esc(p.phone) : '') + (p.visitWanted ? ' · <b style="color:#C2410C">🚶 visite souhaitée</b>' : '') + '</div></td>'
          + '<td>' + _esc(typeof getCityLabel === 'function' ? getCityLabel(p.city) : p.city) + '</td>'
          + '<td><span class="c27-chip ' + p.stage + '">' + (STAGE_LABEL[p.stage] || p.stage) + '</span>' + (p.rate != null ? '<div class="c27-muted">taux ' + p.rate + '%</div>' : '') + '</td>'
          + '<td>' + (p.lastTouch ? p.lastTouch.toLocaleDateString('fr-FR') : '—') + (p.daysSince != null ? '<div class="c27-muted">il y a ' + p.daysSince + ' j · ' + _esc(p.lastExpert) + '</div>' : '') + '</td>'
          + '<td>' + claimCell + '</td><td style="white-space:nowrap">' + acts + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (list.length > shown.length) h += '<div class="c27-muted" style="margin-top:12px">' + _fmt(list.length - shown.length) + ' écoles supplémentaires — affinez les filtres.</div>';
    }
    h += '<div class="c27-note">Classement : écoles libres (non attribuées) d\'abord, puis Chaud → Tiède → Nouveau → Froid → Perdu, puis taux d\'intérêt décroissant, puis contact le plus récent. Une école reste listée tant qu\'elle n\'a pas signé ; dès qu\'elle signe, elle sort de la liste. « Taux » = dernier taux d\'intérêt relevé (0–100 %). Une école « Perdue » reste listée : nouvelle année scolaire, nouveau budget.</div>';
    h += '</div>';
    return h;
  }
  function jsArg(v) { return '\'' + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/"/g, '&quot;') + '\''; }

  window.c27ExportPriority = function () {
    var rows = [['Ecole', 'Ville', 'Pipeline', 'Taux', 'Contact', 'Telephone', 'Dernier contact', 'Jours', 'Dernier expert', 'Attribution ' + CFG.YEAR]];
    buildPriorityList().forEach(function (p) {
      rows.push([p.name, p.city, p.stage, p.rate != null ? p.rate : '', p.contact, p.phone, p.lastTouch ? p.lastTouch.toISOString().slice(0, 10) : '', p.daysSince != null ? p.daysSince : '', p.lastExpert, p.claim ? p.claim.owner : 'LIBRE']);
    });
    downloadCsv('nateiva-liste-prioritaire-' + CFG.YEAR + '.csv', rows);
  };
  function downloadCsv(filename, rows) {
    var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ---------- Onglet 2 : Attributions & demandes ---------- */
  function renderClaimsTab(myClaims, superA, admin) {
    var h = '';
    // Mes écoles 2027
    h += '<div class="c27-card"><div class="c27-klabel">Mon portefeuille ' + CFG.YEAR + '</div><h3>Mes écoles attribuées</h3>'
      + '<p class="c27-sub">Une école vous est attribuée dès votre première saisie ' + CFG.YEAR + ' dessus. Personne d\'autre ne peut y saisir de note sans l\'accord du Super Admin.</p>';
    if (!myClaims.length) {
      h += '<div class="c27-empty">' + (campaignStarted() ? 'Aucune école attribuée pour l\'instant — votre première saisie ' + CFG.YEAR + ' démarre votre portefeuille.' : 'La campagne ouvre le ' + new Date(START_MS).toLocaleDateString('fr-FR') + ' : chaque première saisie vous attribuera l\'école.') + '</div>';
    } else {
      h += '<div style="overflow-x:auto"><table class="c27-tbl"><thead><tr><th>École</th><th>Attribuée le</th></tr></thead><tbody>';
      myClaims.sort(function (a, b) { return (tsMs(b.firstAt) || 0) - (tsMs(a.firstAt) || 0); }).forEach(function (c) {
        h += '<tr><td class="c27-school">' + _esc(c.schoolName) + '</td><td>' + (tsMs(c.firstAt) ? new Date(tsMs(c.firstAt)).toLocaleDateString('fr-FR') : '—') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    // Demandes
    var meU = (window.currentUser.username || '').toLowerCase();
    var reqs = (c27State.requests || []).slice();
    var localPending = (c27State.pendingReqs || []).map(function (r) { return Object.assign({}, r, { status: 'pending', _localOnly: true }); });
    var mine = reqs.concat(localPending).filter(function (r) { return String(r.requestedByUsername || '').toLowerCase() === meU; });
    var forAdmin = superA ? reqs.filter(function (r) { return r.status === 'pending'; }) : [];

    if (superA) {
      h += '<div class="c27-card"><div class="c27-klabel">Super Admin</div><h3>Demandes d\'attribution à décider</h3>'
        + '<p class="c27-sub">Un membre demande l\'accès à une école déjà attribuée. Approuver l\'autorise à saisir des notes sur cette école (le propriétaire actuel la garde aussi).</p>';
      if (!forAdmin.length) h += '<div class="c27-empty">Aucune demande en attente. ✨</div>';
      else {
        h += '<div style="overflow-x:auto"><table class="c27-tbl"><thead><tr><th>École</th><th>Demandeur</th><th>Propriétaire actuel</th><th>Date</th><th>Décision</th></tr></thead><tbody>';
        forAdmin.forEach(function (r) {
          h += '<tr><td class="c27-school">' + _esc(r.schoolName) + '</td><td>' + _esc(r.requestedByFullName || r.requestedByUsername) + '</td>'
            + '<td>' + _esc(r.currentOwnerFullName || '—') + '</td><td>' + (tsMs(r.createdAt) ? new Date(tsMs(r.createdAt)).toLocaleDateString('fr-FR') : '—') + '</td>'
            + '<td style="white-space:nowrap"><button class="c27-act primary" onclick="c27Decide(' + r.id + ',\'approved\')">✅ Approuver</button>'
            + '<button class="c27-act" onclick="c27Decide(' + r.id + ',\'denied\')">⛔ Refuser</button></td></tr>';
        });
        h += '</tbody></table></div>';
      }
      h += '</div>';
      if (admin) {
        var decided = reqs.filter(function (r) { return r.status !== 'pending'; }).slice(0, 20);
        if (decided.length) {
          h += '<div class="c27-card"><h3>Historique des décisions</h3><div style="overflow-x:auto"><table class="c27-tbl"><thead><tr><th>École</th><th>Demandeur</th><th>Statut</th><th>Décidée le</th></tr></thead><tbody>';
          decided.forEach(function (r) {
            h += '<tr><td>' + _esc(r.schoolName) + '</td><td>' + _esc(r.requestedByFullName || r.requestedByUsername) + '</td>'
              + '<td>' + reqChip(r.status) + '</td><td>' + (tsMs(r.decidedAt) ? new Date(tsMs(r.decidedAt)).toLocaleDateString('fr-FR') : '—') + '</td></tr>';
          });
          h += '</tbody></table></div></div>';
        }
      }
    }

    h += '<div class="c27-card"><div class="c27-klabel">Suivi</div><h3>Mes demandes d\'attribution</h3>';
    if (!mine.length) h += '<div class="c27-empty">Aucune demande envoyée. Depuis la liste prioritaire, « 🙋 Demander » sur une école déjà attribuée.</div>';
    else {
      h += '<div style="overflow-x:auto"><table class="c27-tbl"><thead><tr><th>École</th><th>Propriétaire</th><th>Statut</th></tr></thead><tbody>';
      mine.forEach(function (r) {
        h += '<tr><td class="c27-school">' + _esc(r.schoolName) + '</td><td>' + _esc(r.currentOwnerFullName || '—') + '</td>'
          + '<td>' + reqChip(r.status) + (r._localOnly ? ' <span class="c27-muted">(en attente de synchronisation)</span>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
  }
  function reqChip(status) {
    if (status === 'approved') return '<span class="c27-chip appr">✅ Approuvée</span>';
    if (status === 'denied') return '<span class="c27-chip deni">⛔ Refusée</span>';
    return '<span class="c27-chip pend">⏳ En attente</span>';
  }

  /* ---------- Onglet 3 : Pilotage YoY + Insights IA (admin) ---------- */
  function renderPilotTab(priority) {
    var yoy = computeYoY();
    var trust = computeTrust(false);
    var ins = buildInsights(yoy, trust, priority);
    var cur = yoy.cur, prev = yoy.prevW;
    var h = '<div class="c27-card"><div class="c27-klabel">Insights IA — générés automatiquement depuis vos données</div>'
      + '<h3>🤖 Ce que disent les chiffres</h3><p class="c27-sub">Chaque insight indique son mode de calcul. Les comparaisons se font « à période équivalente » : J+' + yoy.windowDays + ' de la campagne ' + CFG.YEAR + ' contre les ' + yoy.windowDays + ' premiers jours d\'activité de la campagne précédente.</p>'
      + '<div class="c27-ins">';
    ins.forEach(function (i) {
      h += '<div class="c27-in ' + i.sev + '"><b>' + i.icon + ' ' + _esc(i.title) + '</b><span>' + _esc(i.text) + '</span></div>';
    });
    h += '</div></div>';

    h += '<div class="c27-card"><div class="c27-klabel">' + CFG.CUR_LABEL + ' vs ' + CFG.PREV_LABEL + ' · période équivalente</div>'
      + '<h3>KPI de campagne</h3><p class="c27-sub">KPI = Key Performance Indicator (indicateur clé de performance). Référence entre parenthèses : valeur de la campagne précédente sur la même durée.</p>'
      + '<div class="c27-tiles">'
      + kpiTile('Saisies totales', cur.entries, prev.entries, true, 'descentes terrain + suivis')
      + kpiTile('Écoles touchées', cur.schools, prev.schools, true, 'écoles distinctes contactées')
      + kpiTile('Appels', cur.calls, prev.calls, true, 'suivis de type appel')
      + kpiTile('Visites terrain', cur.visits, prev.visits, true, 'suivis de type visite')
      + kpiTile('Écoles signées', cur.signed, prev.signed, true, 'deals gagnés sur la période')
      + kpiTile('Taux de conversion', cur.conv.toFixed(1) + '%', prev.conv ? prev.conv.toFixed(1) + '%' : null, true, 'signées ÷ écoles touchées', cur.conv, prev.conv)
      + kpiTile('Coût engagé', _fmt(cur.cost) + ' F', prev.cost ? _fmt(prev.cost) + ' F' : null, false, 'FCFA (Franc CFA) déclarés sur visites', cur.cost, prev.cost)
      + kpiTile('Coût / signature', cur.costPerSign != null ? _fmt(cur.costPerSign) + ' F' : '—', prev.costPerSign != null ? _fmt(prev.costPerSign) + ' F' : null, false, 'coût total ÷ signatures', cur.costPerSign, prev.costPerSign)
      + kpiTile('Prospecteurs actifs', cur.experts, prev.experts, true, 'membres avec ≥ 1 saisie')
      + '</div>'
      + '<div class="c27-note">Campagne précédente (totaux complets, pour mémoire) : ' + _fmt(yoy.prevFull.entries) + ' saisies · ' + _fmt(yoy.prevFull.schools) + ' écoles · ' + _fmt(yoy.prevFull.signed) + ' signatures · ' + _fmt(yoy.prevFull.cost) + ' FCFA engagés.</div>'
      + '</div>';
    return h;
  }
  function kpiTile(label, curV, prevV, goodUp, note, curNum, prevNum) {
    var cn = curNum != null ? curNum : (typeof curV === 'number' ? curV : null);
    var pn = prevNum != null ? prevNum : (typeof prevV === 'number' ? prevV : null);
    return '<div class="c27-tile"><div class="v">' + (typeof curV === 'number' ? _fmt(curV) : curV) + '</div>'
      + '<div class="l">' + label + (prevV != null ? ' <span class="c27-muted">(réf. ' + (typeof prevV === 'number' ? _fmt(prevV) : prevV) + ')</span>' : '') + '</div>'
      + (cn != null ? deltaChip(cn, pn, goodUp) : '')
      + '<div class="c27-muted" style="margin-top:6px;font-size:11px">' + note + '</div></div>';
  }

  /* ---------- Onglet 4 : Score de confiance (admin) ---------- */
  function renderTrustTab() {
    var scope = lsGet(LS_KEYS.trustScope, campaignStarted() ? 'c27' : 'all');
    var trust = computeTrust(scope === 'all');
    var h = '<div class="c27-card"><div class="c27-klabel">Intégrité des données terrain</div>'
      + '<h3>🛡 Score de confiance par prospecteur</h3>'
      + '<p class="c27-sub">Le score démarre à 100 et baisse selon la part de saisies présentant des signaux : GPS manquant sur visite (-' + CFG.TRUST.weights.noGps + ' pts max), écoles multiples au même endroit (-' + CFG.TRUST.weights.cluster + '), déplacement impossible ou position simulée (-' + CFG.TRUST.weights.travel + '), remplissage trop rapide (-' + CFG.TRUST.weights.fast + '), téléphone dupliqué (-' + CFG.TRUST.weights.dupPhone + '), rafales (-' + CFG.TRUST.weights.burst + '), précision faible (-' + CFG.TRUST.weights.lowAcc + '), saisie nocturne (-' + CFG.TRUST.weights.night + '). Chaque pénalité = poids × (saisies concernées ÷ saisies totales). <b>Ce sont des signaux à vérifier, pas des verdicts</b> : une rafale du soir peut être la saisie honnête d\'une tournée hors-ligne.</p>'
      + '<div class="c27-filters">'
      + '<select onchange="c27SetTrustScope(this.value)">'
      + '<option value="c27"' + (scope === 'c27' ? ' selected' : '') + '>Campagne ' + CFG.YEAR + '</option>'
      + '<option value="all"' + (scope === 'all' ? ' selected' : '') + '>Tout l\'historique</option></select>'
      + '<button class="c27-act" onclick="c27ExportTrust()">⬇️ Export CSV</button>'
      + '</div>';
    if (!trust.report.length || !trust.totalEntries) {
      h += '<div class="c27-empty">' + (scope === 'c27' && !campaignStarted() ? 'Le score de confiance se calculera sur les saisies de la campagne ' + CFG.YEAR + ' (GPS inclus) dès son ouverture. Basculez sur « Tout l\'historique » pour les contrôles hors GPS (téléphones dupliqués, rafales…).' : 'Aucune saisie sur la période.') + '</div></div>';
      return h;
    }
    h += '<div style="overflow-x:auto"><table class="c27-tbl"><thead><tr>'
      + '<th>#</th><th>Prospecteur</th><th>Score</th><th>Saisies</th><th>Signalées</th><th>Couverture GPS</th><th>Signaux principaux</th></tr></thead><tbody>';
    var FLAG_SHORT = { noGps: 'GPS manquant', lowAcc: 'Précision faible', cluster: 'Même endroit', travel: 'Déplacement impossible', fast: 'Trop rapide', burst: 'Rafales', dupPhone: 'Tél. dupliqué', night: 'Nocturne' };
    trust.report.forEach(function (r, idx) {
      var tops = Object.keys(r.counts).filter(function (k) { return r.counts[k] > 0; })
        .sort(function (a, b) { return r.counts[b] - r.counts[a]; }).slice(0, 3)
        .map(function (k) { return FLAG_SHORT[k] + ' ×' + r.counts[k]; }).join(' · ') || '—';
      h += '<tr><td class="c27-muted">' + (idx + 1) + '</td>'
        + '<td><div class="c27-school">' + _esc(r.expert) + '</div><div class="c27-bar"><i style="width:' + r.score + '%"></i></div></td>'
        + '<td>' + scoreBadge(r.score) + '</td>'
        + '<td>' + _fmt(r.entries) + '</td>'
        + '<td>' + (r.flagged ? '<b>' + _fmt(r.flagged) + '</b> <span class="c27-muted">(' + Math.round(100 * r.flagged / r.entries) + '%)</span>' : '0') + '</td>'
        + '<td>' + (r.gpsRate == null ? '<span class="c27-muted">n/a</span>' : r.gpsRate + '%') + '</td>'
        + '<td style="max-width:260px"><span class="c27-muted">' + tops + '</span>'
        + (r.flaggedEntries.length ? '<details class="c27-det"><summary>Voir les ' + r.flaggedEntries.length + ' saisies signalées</summary>'
          + r.flaggedEntries.map(function (e) {
            return '<div class="c27-flag"><b>' + _esc(e.school) + '</b> · ' + (e.ts ? new Date(e.ts).toLocaleString('fr-FR') : '') + ' · ' + _esc(e.type)
              + '<br>' + e.flags.map(function (f) { return '• ' + _esc(f.m); }).join('<br>') + '</div>';
          }).join('') + '</details>' : '')
        + '</td></tr>';
    });
    h += '</tbody></table></div>'
      + '<div class="c27-note">Couverture GPS = visites/descentes de la campagne ' + CFG.YEAR + ' avec position ÷ total de ces saisies. Le GPS est capturé silencieusement à l\'ouverture et à l\'envoi du formulaire ; une saisie sans position reste acceptée mais pèse sur le score. Rappel : vérifier avant de sanctionner — appeler le directeur de l\'école concernée reste le meilleur contrôle.</div>'
      + '</div>';
    return h;
  }

  window.c27ExportTrust = function () {
    var scope = lsGet(LS_KEYS.trustScope, campaignStarted() ? 'c27' : 'all');
    var trust = computeTrust(scope === 'all');
    var rows = [['Rang', 'Prospecteur', 'Score/100', 'Saisies', 'Signalees', 'Couverture GPS %', 'GPS manquant', 'Precision faible', 'Meme endroit', 'Deplacement impossible', 'Trop rapide', 'Rafales', 'Tel duplique', 'Nocturne']];
    trust.report.forEach(function (r, i) {
      rows.push([i + 1, r.expert, r.score, r.entries, r.flagged, r.gpsRate == null ? '' : r.gpsRate,
        r.counts.noGps || 0, r.counts.lowAcc || 0, r.counts.cluster || 0, r.counts.travel || 0, r.counts.fast || 0, r.counts.burst || 0, r.counts.dupPhone || 0, r.counts.night || 0]);
    });
    downloadCsv('nateiva-score-confiance-' + (scope === 'all' ? 'historique' : CFG.YEAR) + '.csv', rows);
  };

  /* ======================= 7. BRANCHEMENTS (HOOKS) ======================== */
  function boot() {
    injectCss();
    // Enregistrement du pane dans le registre des rendus + état « à rafraîchir ».
    try {
      if (window._paneDirty) window._paneDirty.c27 = true;
      if (typeof window._getPaneRenderers === 'function') {
        var m = window._getPaneRenderers();
        if (m && !m.c27) m.c27 = rC27;
      }
    } catch (e) { }
    // Capture GPS : au chargement (si connecté), à l'activation du Workspace et du pane 2027.
    if (window.currentUser) geoCapture('boot');
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-pane]') : null;
      if (!btn) return;
      var pane = btn.dataset ? btn.dataset.pane : '';
      if (pane === 'suivi') { geoCapture('workspace'); markFormOpened(); }
      if (pane === 'c27') { geoCapture('c27'); setTimeout(rC27, 50); }
    }, true);
    // Ouverture du panneau « Nouveau suivi » → horodatage du formulaire.
    var _origActivate = window.activateSuiviPanel;
    if (typeof _origActivate === 'function') {
      window.activateSuiviPanel = function (key, opts) {
        if (key === 'add') markFormOpened();
        return _origActivate(key, opts);
      };
    }
    flushPendingRequests();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
