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
      weights: { noGps: 25, lowAcc: 10, cluster: 30, travel: 30, fast: 20, burst: 15, dupPhone: 20, night: 5, photoFlag: 15 }
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
  // Accès aux données COMPLÈTES (toutes années), même quand le dashboard est
  // filtré sur une campagne : les moteurs internes (attributions, confiance,
  // comparaisons annuelles, carte) ont besoin de tout l'historique.
  var ORIG_FN = {};
  function fullRows() { var f = ORIG_FN.getAllRawRows || window.getAllRawRows; return typeof f === 'function' ? f() : []; }
  function fullFups() { var f = ORIG_FN.getAllFollowups || window.getAllFollowups; return typeof f === 'function' ? f() : []; }
  function fullVisibleFups() { var f = ORIG_FN.getVisibleFollowups || window.getVisibleFollowups; return typeof f === 'function' ? f() : []; }
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
      if (typeof applyPhotoMeta === 'function') applyPhotoMeta(meta); // photo terrain prise sur place
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
    var fups = fullFups();
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
    if (typeof buildSchoolRecords !== 'function') return [];
    var raws = fullRows(), fups = fullFups();
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
    var fups = fullFups();
    var entries = fups.filter(function (f) {
      if (!f || !f.Timestamp || !f.Expert) return false;
      return scopeAll ? true : inCampaign(f.Timestamp);
    }).map(function (f) {
      var geo = readEntryGeo(f);
      return {
        id: f.ID || '', ts: tsMs(f.Timestamp), tsIso: f.Timestamp,
        expert: canonicalPersonName(f.Expert), school: f.SchoolName || '', key: schoolKey(f.SchoolName),
        type: f.FollowupType || '', phone: (typeof digitsOnly === 'function') ? digitsOnly(f.ContactPhone) : String(f.ContactPhone || ''),
        city: f.City || '', geo: geo, flags: [],
        photoFlag: (function () { var m = entryMetaOf(f); if (m.photoReview === 'rejected') return 'rejected'; if (m.photoReviewNeeded === '1' && m.photoReview !== 'ok') return 'pending'; return ''; })(),
        photoBy: (function () { var m = entryMetaOf(f); return m.photoReviewBy || ''; })()
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
      if (e.photoFlag) e.flags.push({ t: 'photoFlag', m: e.photoFlag === 'rejected' ? 'Photo REJETÉE par ' + (e.photoBy || 'un admin') + ' après vérification' : 'Nom de l\'école non reconnu sur la photo (en attente de vérification)' });
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
      var counts = { noGps: 0, lowAcc: 0, cluster: 0, travel: 0, fast: 0, burst: 0, dupPhone: 0, night: 0, photoFlag: 0 };
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
  function computeYoY(fupsIn, rawsIn) {
    var fups = fupsIn || fullFups();
    var raws = rawsIn || fullRows();
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
      + tabBtn('map', '🗺 Carte des écoles', tab)
      + tabBtn('claims', '👑 Attributions & demandes', tab)
      + (admin ? tabBtn('pilot', '📊 Pilotage & IA', tab) : '')
      + (admin ? tabBtn('trust', '🛡 Score de confiance', tab) : '')
      + '</div>';

    if (tab === 'list') h += renderPriorityTab(priority, admin);
    else if (tab === 'map') h += renderMapTab(admin);
    else if (tab === 'claims') h += renderClaimsTab(myClaims, superA, admin);
    else if (tab === 'pilot') h += renderPilotTab(priority);
    else if (tab === 'trust') h += renderTrustTab();

    h += '</div>';
    el.innerHTML = h;
    if (tab === 'map') setTimeout(initMap, 60);
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
    var h = renderPhotoReviewQueue();
    h += renderGpsRefusalReport(scope === 'all');
    h += '<div class="c27-card"><div class="c27-klabel">Intégrité des données terrain</div>'
      + '<h3>🛡 Score de confiance par prospecteur</h3>'
      + '<p class="c27-sub">Le score démarre à 100 et baisse selon la part de saisies présentant des signaux : GPS manquant sur visite (-' + CFG.TRUST.weights.noGps + ' pts max), écoles multiples au même endroit (-' + CFG.TRUST.weights.cluster + '), déplacement impossible ou position simulée (-' + CFG.TRUST.weights.travel + '), remplissage trop rapide (-' + CFG.TRUST.weights.fast + '), téléphone dupliqué (-' + CFG.TRUST.weights.dupPhone + '), rafales (-' + CFG.TRUST.weights.burst + '), photo non concordante ou rejetée (-' + CFG.TRUST.weights.photoFlag + '), précision faible (-' + CFG.TRUST.weights.lowAcc + '), saisie nocturne (-' + CFG.TRUST.weights.night + '). Chaque pénalité = poids × (saisies concernées ÷ saisies totales). <b>Ce sont des signaux à vérifier, pas des verdicts</b> : une rafale du soir peut être la saisie honnête d\'une tournée hors-ligne.</p>'
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
    var FLAG_SHORT = { noGps: 'GPS manquant', lowAcc: 'Précision faible', cluster: 'Même endroit', travel: 'Déplacement impossible', fast: 'Trop rapide', burst: 'Rafales', dupPhone: 'Tél. dupliqué', night: 'Nocturne', photoFlag: 'Photo à vérifier/rejetée' };
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
    var rows = [['Rang', 'Prospecteur', 'Score/100', 'Saisies', 'Signalees', 'Couverture GPS %', 'GPS manquant', 'Precision faible', 'Meme endroit', 'Deplacement impossible', 'Trop rapide', 'Rafales', 'Tel duplique', 'Nocturne', 'Photo a verifier']];
    trust.report.forEach(function (r, i) {
      rows.push([i + 1, r.expert, r.score, r.entries, r.flagged, r.gpsRate == null ? '' : r.gpsRate,
        r.counts.noGps || 0, r.counts.lowAcc || 0, r.counts.cluster || 0, r.counts.travel || 0, r.counts.fast || 0, r.counts.burst || 0, r.counts.dupPhone || 0, r.counts.night || 0, r.counts.photoFlag || 0]);
    });
    downloadCsv('nateiva-score-confiance-' + (scope === 'all' ? 'historique' : CFG.YEAR) + '.csv', rows);
  };

  /* ======================= 8. PÉRIMÈTRE ANNUEL (YEAR SCOPE) ============== */
  // Dès le 1er janvier 2027, TOUT le dashboard démarre sur la campagne en
  // cours : les autres onglets ne voient que les données de l'année. Le
  // sélecteur d'année dans l'en-tête permet de consulter les campagnes
  // passées (« Campagne 2026 & avant » regroupe tout l'historique pré-2027).
  var SCOPE_KEY = 'nateiva_c27_year_scope';

  function activeCampaignYear() {
    var y = new Date(Date.now()).getFullYear();
    return y >= CFG.YEAR ? Math.max(y, CFG.YEAR) : null; // null = campagne pas commencée
  }
  function scopeWindow(year) {
    if (year <= CFG.YEAR - 1) return [-Infinity, START_MS]; // 2026 & avant = tout le pré-2027
    return [Date.parse(year + '-01-01T00:00:00'), Date.parse((year + 1) + '-01-01T00:00:00')];
  }
  function scopeActive() {
    var s = lsGet(SCOPE_KEY, 'auto');
    if (s === 'auto') { var y = activeCampaignYear(); return y ? String(y) : 'all'; }
    return s; // 'all' ou une année en chaîne
  }
  function inActiveScope(ms) {
    if (ms == null) return true; // jamais masquer une saisie sans date lisible
    var s = scopeActive();
    if (s === 'all') return true;
    var w = scopeWindow(Number(s));
    return ms >= w[0] && ms < w[1];
  }
  function scopeYears() {
    var years = {};
    fullRows().forEach(function (r) { var m = tsMs(r.t); if (m != null) years[new Date(m).getFullYear()] = 1; });
    fullFups().forEach(function (f) { var m = tsMs(f.Timestamp); if (m != null) years[new Date(m).getFullYear()] = 1; });
    var cy = activeCampaignYear(); if (cy) years[cy] = 1;
    years[CFG.YEAR - 1] = 1; // l'option « Campagne 2026 & avant » existe toujours
    // Les années pré-2027 sont regroupées sous une seule option (CFG.YEAR - 1).
    var out = {};
    Object.keys(years).map(Number).forEach(function (y) { out[y >= CFG.YEAR ? y : (CFG.YEAR - 1)] = 1; });
    return Object.keys(out).map(Number).sort(function (a, b) { return b - a; });
  }
  function markAllDirty() {
    try { Object.keys(window._paneDirty || {}).forEach(function (k) { window._paneDirty[k] = true; }); } catch (e) { }
  }
  window.c27SetScope = function (v) {
    lsSet(SCOPE_KEY, v);
    markAllDirty();
    injectScopePill();
    if (typeof window.renderAll === 'function') { try { window.renderAll(); } catch (e) { } }
    repaint();
  };

  function installScopeWrappers() {
    if (ORIG_FN.getAllRawRows) return;
    if (typeof window.getAllRawRows === 'function') {
      ORIG_FN.getAllRawRows = window.getAllRawRows;
      window.getAllRawRows = function () { return ORIG_FN.getAllRawRows().filter(function (r) { return inActiveScope(tsMs(r && r.t)); }); };
    }
    if (typeof window.getAllFollowups === 'function') {
      ORIG_FN.getAllFollowups = window.getAllFollowups;
      window.getAllFollowups = function () { return ORIG_FN.getAllFollowups().filter(function (f) { return inActiveScope(tsMs(f && f.Timestamp)); }); };
    }
    if (typeof window.getVisibleFollowups === 'function') {
      ORIG_FN.getVisibleFollowups = window.getVisibleFollowups;
      window.getVisibleFollowups = function () { return ORIG_FN.getVisibleFollowups().filter(function (f) { return inActiveScope(tsMs(f && f.Timestamp)); }); };
    }
  }

  function scopeLabel(s) {
    if (s === 'all') return 'Tout l\'historique';
    var y = Number(s);
    return y <= CFG.YEAR - 1 ? 'Campagne ' + (CFG.YEAR - 1) + ' & avant' : 'Campagne ' + y;
  }
  function injectScopePill() {
    try {
      var block = document.querySelector('.meta-block');
      if (!block) return;
      var pill = document.getElementById('c27ScopePill');
      if (!pill) {
        pill = document.createElement('span');
        pill.id = 'c27ScopePill';
        pill.className = 'meta-pill';
        pill.style.cssText = 'background:#1C1917;color:#F4EBD6;border:1px solid #B08D2F;display:inline-flex;align-items:center;gap:7px;cursor:pointer';
        block.insertBefore(pill, block.firstChild);
      }
      var s = scopeActive();
      var stored = lsGet(SCOPE_KEY, 'auto');
      var years = scopeYears();
      var opts = '';
      years.forEach(function (y) {
        var val = String(y <= CFG.YEAR - 1 ? (CFG.YEAR - 1) : y);
        if (opts.indexOf('value="' + val + '"') > -1) return;
        opts += '<option value="' + val + '"' + (stored !== 'all' && s === val ? ' selected' : '') + '>' + scopeLabel(val) + '</option>';
      });
      opts += '<option value="all"' + (stored === 'all' ? ' selected' : '') + '>Tout l\'historique</option>';
      pill.innerHTML = '📅 <select id="c27ScopeSel" style="background:transparent;color:#F4EBD6;border:none;font:inherit;font-weight:700;outline:none;cursor:pointer" onchange="c27SetScope(this.value)">' + opts + '</select>';
      var sel = document.getElementById('c27ScopeSel');
      if (sel) { for (var i = 0; i < sel.options.length; i++) sel.options[i].style.color = '#1C1917'; }
    } catch (e) { }
  }

  /* ======================= 9. BANDEAU « CETTE ANNÉE VS N-1 » ============== */
  // Injecté en tête des onglets Dashboard, Analytics, Équipe, Activité et
  // Marché dès que la campagne 2027 est ouverte : les KPI clés de l'année en
  // cours comparés à la campagne précédente À PÉRIODE ÉQUIVALENTE, avec un
  // Indice de forme global. En consultation d'une année passée, le bandeau
  // devient un marqueur « Archive ».
  var STRIP_PANES = { home: 1, metrics: 1, team: 1, market: 1, activity: 1 };

  function visibleDataForStrip() {
    var fups = fullVisibleFups();
    var rows = fullRows();
    var seeAll = (typeof canSeeAllData === 'function') && canSeeAllData(window.currentUser);
    if (!seeAll && window.currentUser) {
      rows = rows.filter(function (r) { return samePerson(r.e, _me()); });
      // fullVisibleFups est déjà restreint aux saisies de l'utilisateur côté données
    }
    return { rows: rows, fups: fups };
  }

  function formIndex(yoy) {
    // Indice de forme = moyenne des variations (%) vs N-1 à période équivalente
    // sur 4 KPI : saisies, écoles touchées, visites, signatures. Borné à ±100.
    var pairs = [[yoy.cur.entries, yoy.prevW.entries], [yoy.cur.schools, yoy.prevW.schools], [yoy.cur.visits, yoy.prevW.visits], [yoy.cur.signed, yoy.prevW.signed]];
    var ds = [];
    pairs.forEach(function (p) {
      if (p[1] > 0) ds.push(Math.max(-100, Math.min(100, 100 * (p[0] - p[1]) / p[1])));
      else if (p[0] > 0) ds.push(100);
    });
    if (!ds.length) return null;
    return Math.round(ds.reduce(function (a, b) { return a + b; }, 0) / ds.length);
  }

  function buildStripHtml() {
    var s = scopeActive();
    if (s === 'all' && !campaignStarted()) return '';
    if (s !== 'all' && Number(s) <= CFG.YEAR - 1) {
      return '<div class="c27-strip c27-strip-archive">📦 <b>Archive — ' + scopeLabel(s) + '</b> · lecture des données passées. '
        + '<a href="javascript:void(0)" onclick="c27SetScope(\'auto\')">Revenir à la campagne en cours →</a></div>';
    }
    if (!campaignStarted()) return '';
    var data = visibleDataForStrip();
    var yoy = computeYoY(data.fups, data.rows);
    var fi = formIndex(yoy);
    var mood = fi == null ? ['⚪', 'Pas encore de référence', 'c27-fi-na'] : fi >= 10 ? ['🟢', 'En avance sur ' + (CFG.YEAR - 1), 'c27-fi-good'] : fi >= -10 ? ['🟡', 'Au niveau de ' + (CFG.YEAR - 1), 'c27-fi-mid'] : ['🔴', 'En retard sur ' + (CFG.YEAR - 1), 'c27-fi-bad'];
    function chip(label, cur, prev, goodUp) {
      return '<span class="c27-chipk"><i>' + label + '</i><b>' + _fmt(cur) + '</b>' + deltaChip(cur, prev, goodUp) + '</span>';
    }
    return '<div class="c27-strip">'
      + '<span class="c27-fi ' + mood[2] + '" title="Indice de forme = moyenne des variations en % vs campagne précédente à période équivalente (J+' + yoy.windowDays + ') sur 4 KPI : saisies, écoles touchées, visites, signatures. Borné à ±100.">' + mood[0] + ' <b>' + (fi == null ? '—' : (fi > 0 ? '+' : '') + fi) + '</b><em>' + mood[1] + '</em></span>'
      + chip('Saisies', yoy.cur.entries, yoy.prevW.entries, true)
      + chip('Écoles', yoy.cur.schools, yoy.prevW.schools, true)
      + chip('Visites', yoy.cur.visits, yoy.prevW.visits, true)
      + chip('Signatures', yoy.cur.signed, yoy.prevW.signed, true)
      + chip('Conversion %', Math.round(yoy.cur.conv * 10) / 10, Math.round(yoy.prevW.conv * 10) / 10, true)
      + '<span class="c27-chipk"><i>vs ' + (CFG.YEAR - 1) + ' à J+' + yoy.windowDays + '</i><b>📅</b></span>'
      + '</div>';
  }

  var STRIP_CSS = ''
    + '.c27-strip{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 18px;padding:13px 16px;border:1px solid #E7E5E4;border-radius:14px;background:linear-gradient(135deg,#FAFAF9,#F7F1E3);box-shadow:0 1px 2px rgba(0,0,0,.03);font-size:12.5px}'
    + '.c27-strip-archive{background:#1C1917;color:#F4EBD6;border-color:#B08D2F;font-size:13px}'
    + '.c27-strip-archive a{color:#D4AF37;font-weight:700;text-decoration:none}'
    + '.c27-chipk{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #E7E5E4;border-radius:999px;padding:6px 12px}'
    + '.c27-chipk i{font-style:normal;font-family:"JetBrains Mono",monospace;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:#78716C}'
    + '.c27-chipk b{font-family:"Fraunces",serif;font-size:16px}'
    + '.c27-chipk .c27-delta{margin-top:0}'
    + '.c27-fi{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:7px 14px;font-size:13px;border:1px solid transparent}'
    + '.c27-fi b{font-family:"Fraunces",serif;font-size:17px}.c27-fi em{font-style:normal;font-size:11.5px;font-weight:600}'
    + '.c27-fi-good{background:#ECFDF5;color:#047857;border-color:#A7F3D0}.c27-fi-mid{background:#FFFBEB;color:#B45309;border-color:#FDE68A}'
    + '.c27-fi-bad{background:#FEF2F2;color:#B91C1C;border-color:#FECACA}.c27-fi-na{background:#F5F5F4;color:#78716C}'
    + '.c27-delta{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:10.5px;padding:2px 7px;border-radius:6px}'
    + '.c27-d-up{background:#ECFDF5;color:#047857}.c27-d-down{background:#FEF2F2;color:#B91C1C}.c27-d-na{background:#F5F5F4;color:#78716C}';

  function injectStripCss() {
    if (document.getElementById('c27-strip-style')) return;
    var st = document.createElement('style');
    st.id = 'c27-strip-style';
    st.textContent = STRIP_CSS;
    document.head.appendChild(st);
  }

  function prependStrip(paneKey) {
    try {
      if (!window.currentUser) return;
      injectStripCss();
      var pane = document.getElementById('p-' + paneKey);
      if (!pane) return;
      var old = pane.querySelector('.c27-strip'); if (old) old.remove();
      var html = buildStripHtml();
      if (!html) return;
      var div = document.createElement('div');
      div.innerHTML = html;
      pane.insertBefore(div.firstChild, pane.firstChild);
    } catch (e) { }
  }

  function wrapPaneRenderers() {
    try {
      if (typeof window._getPaneRenderers !== 'function') return;
      var m = window._getPaneRenderers();
      Object.keys(STRIP_PANES).forEach(function (key) {
        var orig = m[key];
        if (typeof orig !== 'function' || orig.__c27Wrapped) return;
        var wrapped = function () { var r = orig.apply(this, arguments); prependStrip(key); return r; };
        wrapped.__c27Wrapped = true;
        m[key] = wrapped;
      });
    } catch (e) { }
  }

  /* ======================= 10. CARTE DES ÉCOLES + TERRAIN ================= */
  // Carte Leaflet (bibliothèque libre) + fonds OpenStreetMap (gratuit, sans
  // clé API). Position précise = meilleure position GPS des saisies 2027 ;
  // sinon position approximative au centre-ville (dispersée de façon stable)
  // en attendant la première visite géolocalisée.
  var CITY_COORDS = {
    'DOUALA': [4.0511, 9.7679], 'YAOUNDE': [3.8480, 11.5021], 'BAFOUSSAM': [5.4781, 10.4179],
    'BAMENDA': [5.9631, 10.1591], 'GAROUA': [9.3265, 13.3958], 'MAROUA': [10.5956, 14.3247],
    'NGAOUNDERE': [7.3167, 13.5833], 'BERTOUA': [4.5776, 13.6846], 'EBOLOWA': [2.9000, 11.1500],
    'BUEA': [4.1527, 9.2920], 'LIMBE': [4.0215, 9.2125], 'KUMBA': [4.6363, 9.4469],
    'KRIBI': [2.9404, 9.9098], 'EDEA': [3.8000, 10.1333], 'NKONGSAMBA': [4.9547, 9.9404],
    'DSCHANG': [5.4437, 10.0533], 'FOUMBAN': [5.7287, 10.8984], 'MBALMAYO': [3.5167, 11.5000],
    'SANGMELIMA': [2.9333, 11.9833], 'BAFIA': [4.7500, 11.2333], 'KUMBO': [6.2000, 10.6667],
    'MBOUDA': [5.6264, 10.2542], 'LOUM': [4.7182, 9.7351], 'YAGOUA': [10.3428, 15.2406], 'MEIGANGA': [6.5167, 14.3000]
  };
  var STAGE_COLOR = { gagne: '#047857', chaud: '#DC2626', tiede: '#D97706', nouveau: '#2563EB', froid: '#78716C', perdu: '#44403C' };
  var _map = null, _mapLayer = null, _trackLayer = null;
  var _mapState = { city: '', q: '', stage: '', precise: '', expert: '', period: 'c27' };

  function ensureLeaflet(cb) {
    if (window.L && window.L.map) return cb();
    if (!document.getElementById('c27-leaflet-css')) {
      var link = document.createElement('link');
      link.id = 'c27-leaflet-css'; link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    var sc = document.getElementById('c27-leaflet-js');
    if (sc) { sc.addEventListener('load', cb); return; }
    sc = document.createElement('script');
    sc.id = 'c27-leaflet-js';
    sc.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    sc.onload = cb;
    sc.onerror = function () {
      var sc2 = document.createElement('script');
      sc2.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js';
      sc2.onload = cb;
      sc2.onerror = function () {
        var box = document.getElementById('c27MapBox');
        if (box) box.innerHTML = '<div class="c27-empty">Impossible de charger la carte (connexion requise la première fois). Réessayez en ligne.</div>';
      };
      document.head.appendChild(sc2);
    };
    document.head.appendChild(sc);
  }

  function schoolGpsIndex() {
    // meilleure position GPS par école : priorité visites, puis précision
    var idx = {};
    fullFups().forEach(function (f) {
      if (!f) return;
      var geo = readEntryGeo(f);
      if (!geo || !geo.has) return;
      var k = schoolKey(f.SchoolName); if (!k) return;
      var isVisit = f.FollowupType === 'VISIT' || f.FollowupType === 'PROSPECTION';
      var cur = idx[k];
      var better = !cur || (isVisit && !cur.isVisit) || (isVisit === !!cur.isVisit && (geo.acc || 9999) < (cur.acc || 9999));
      if (better) idx[k] = { lat: geo.lat, lng: geo.lng, acc: geo.acc, at: f.Timestamp, isVisit: isVisit };
    });
    return idx;
  }
  function schoolPhotoIndex() {
    // dernière photo terrain par école (vignette compressée stockée dans la saisie)
    var idx = {};
    fullFups().forEach(function (f) {
      if (!f || typeof splitFollowupNotes !== 'function') return;
      var m = splitFollowupNotes(f.Notes).meta || {};
      if (!m.photoData) return;
      var k = schoolKey(f.SchoolName); if (!k) return;
      var ms = tsMs(f.Timestamp) || 0;
      if (!idx[k] || idx[k].ts < ms) idx[k] = { data: m.photoData, ts: ms };
    });
    return idx;
  }

  function jitterFor(key, span) {
    var hsh = 0; for (var i = 0; i < key.length; i++) { hsh = ((hsh << 5) - hsh + key.charCodeAt(i)) | 0; }
    var a = ((hsh % 1000) / 1000) * Math.PI * 2, r = (((hsh >> 10) % 1000) / 1000) * span;
    return [Math.sin(a) * r, Math.cos(a) * r];
  }

  function buildMapSchools() {
    var recs = (typeof buildSchoolRecords === 'function') ? buildSchoolRecords(fullRows(), fullFups()) : [];
    var gps = schoolGpsIndex();
    var claims = getClaimsMap();
    return recs.filter(function (r) { return r && r.schoolName; }).map(function (r) {
      var k = r.key || schoolKey(r.schoolName);
      var g = gps[k] || null;
      var city = String(r.city || '').toUpperCase().trim();
      var cc = CITY_COORDS[city] || null;
      var pos = null, precise = false;
      if (g) { pos = [g.lat, g.lng]; precise = true; }
      else if (cc) { var j = jitterFor(k, 0.025); pos = [cc[0] + j[0], cc[1] + j[1]]; }
      return {
        key: k, name: r.schoolName, city: city, stage: r.stage || 'nouveau',
        effectif: (r.effectif && r.effectif > 0) ? r.effectif : null,
        standing: r.standing || '', type: r.type || '', quartier: r.quartier || r.zone || '',
        location: r.location || '', phone: r.phone || '', contact: r.contactName || '',
        rate: r.rate != null ? r.rate : null, lastTouch: r.lastTouch || null,
        owner: claims[k] ? claims[k].owner : '', pos: pos, precise: precise, gpsAt: g ? g.at : null
      };
    }).filter(function (s) { return !!s.pos; });
  }

  window.c27MapFilter = function (k, v) { _mapState[k] = v; refreshMapMarkers(); };
  window.c27MapTrack = function (k, v) { _mapState[k] = v; refreshTrack(); };

  /* ---------- 10b. Écoles découvertes sur Internet (OpenStreetMap) ---------- */
  // En plus de nos écoles, la carte peut charger TOUTES les écoles connues
  // d'OpenStreetMap (base cartographique mondiale alimentée par la communauté,
  // les gouvernements et l'imagerie satellite) : maternelles, primaires,
  // secondaires et universités, avec leur position réelle. Chaque école
  // découverte est automatiquement rapprochée de notre base : si on ne la
  // connaît pas, elle est marquée « à prospecter ». Requête via l'API Overpass
  // (gratuite, sans clé), mise en cache 14 jours sur l'appareil.
  var OSM_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];
  var OSM_CACHE_DAYS = 14;
  var _osmData = {};      // city → [{name,lat,lng,kind,tags}]
  var _osmLoading = '';

  function osmCacheKey(city) { return 'nateiva_c27_osm_' + normalizeText(city).replace(/\s+/g, '_'); }
  function osmKindOf(tags) {
    var a = (tags.amenity || '').toLowerCase();
    var name = normalizeText(tags.name || '');
    if (a === 'university') return 'Université';
    if (a === 'college') return 'Supérieur / Grande école';
    if (a === 'kindergarten') return 'Maternelle';
    if (/universite|university|institut superieur|polytech/.test(name)) return 'Université';
    if (/lycee|lycée|college|collège|secondary|high school|comprehensive/.test(name)) return 'Secondaire';
    if (/maternelle|nursery|kindergarten|creche/.test(name)) return 'Maternelle';
    return 'Primaire / École';
  }
  var OSM_GENERIC_TOKENS = { groupe: 1, scolaire: 1, bilingue: 1, bilingual: 1, complexe: 1, college: 1, lycee: 1, ecole: 1, school: 1, schools: 1, nursery: 1, primary: 1, secondary: 1, high: 1, prive: 1, privee: 1, laic: 1, laique: 1, publique: 1, public: 1, the: 1, and: 1, et: 1, de: 1, du: 1, des: 1, la: 1, le: 1, les: 1, institut: 1, institution: 1, academy: 1, academie: 1, centre: 1, center: 1, gs: 1, gsb: 1, csb: 1, nkk: 1, enieg: 1 };
  function osmNameTokens(name) {
    return normalizeText(name).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter(function (t) { return t.length > 1 && !OSM_GENERIC_TOKENS[t]; });
  }
  function osmMatchesOurs(osmName, ourTokensIndex) {
    var t = osmNameTokens(osmName);
    if (!t.length) return null;
    var best = null, bestScore = 0;
    Object.keys(ourTokensIndex).forEach(function (key) {
      var ours = ourTokensIndex[key];
      if (!ours.length) return;
      var inter = 0;
      t.forEach(function (tok) { if (ours.indexOf(tok) > -1) inter++; });
      var score = inter / Math.max(1, Math.min(t.length, ours.length));
      if (score > bestScore) { bestScore = score; best = key; }
    });
    return bestScore >= 0.6 ? best : null;
  }

  window.c27LoadOsm = function () {
    var city = (_mapState.city || 'DOUALA').toUpperCase();
    var cc = CITY_COORDS[city];
    var btn = document.getElementById('c27OsmBtn');
    if (!cc) { _toast('Sélectionnez d\'abord une ville connue de la carte', true); return; }
    // cache appareil
    try {
      var cached = JSON.parse(localStorage.getItem(osmCacheKey(city)) || 'null');
      if (cached && cached.at && (Date.now() - cached.at) < OSM_CACHE_DAYS * 86400000 && Array.isArray(cached.items)) {
        _osmData[city] = cached.items;
        _mapState.osm = '1';
        refreshMapMarkers();
        return;
      }
    } catch (e) { }
    if (_osmLoading === city) return;
    _osmLoading = city;
    if (btn) { btn.disabled = true; btn.textContent = '🌐 Chargement des écoles de ' + city + '…'; }
    var query = '[out:json][timeout:50];(nwr["amenity"~"^(school|college|university|kindergarten)$"](around:30000,' + cc[0] + ',' + cc[1] + '););out center tags;';
    var tryEndpoint = function (i) {
      if (i >= OSM_ENDPOINTS.length) {
        _osmLoading = '';
        if (btn) { btn.disabled = false; btn.textContent = '🌐 Réessayer le chargement Internet'; }
        _toast('Serveurs OpenStreetMap injoignables — réessayez dans quelques minutes', true);
        return;
      }
      fetch(OSM_ENDPOINTS[i], { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (json) {
          var items = (json.elements || []).map(function (el) {
            var lat = el.lat != null ? el.lat : (el.center ? el.center.lat : null);
            var lng = el.lon != null ? el.lon : (el.center ? el.center.lon : null);
            var tags = el.tags || {};
            if (lat == null || lng == null || !tags.name) return null;
            return {
              name: tags.name, lat: lat, lng: lng, kind: osmKindOf(tags),
              operator: tags.operator || '', religion: tags.religion || '',
              capacity: tags.capacity || tags['capacity:pupils'] || '', fee: tags.fee || '',
              phone: tags.phone || tags['contact:phone'] || '',
              quartier: tags['addr:suburb'] || tags['addr:quarter'] || tags['addr:street'] || ''
            };
          }).filter(Boolean);
          _osmData[city] = items;
          try { localStorage.setItem(osmCacheKey(city), JSON.stringify({ at: Date.now(), items: items })); } catch (e) { }
          _osmLoading = '';
          _mapState.osm = '1';
          _toast(items.length + ' écoles trouvées sur Internet pour ' + city + ' ✓');
          var pane = document.getElementById('p-c27');
          if (pane && pane.classList.contains('act')) { rC27(); }
        })
        .catch(function () { tryEndpoint(i + 1); });
    };
    tryEndpoint(0);
  };

  function discoveredForCity(city) {
    var items = _osmData[city];
    if (!items) {
      try {
        var cached = JSON.parse(localStorage.getItem(osmCacheKey(city)) || 'null');
        if (cached && Array.isArray(cached.items)) { _osmData[city] = cached.items; items = cached.items; }
      } catch (e) { }
    }
    return items || [];
  }

  function renderMapTab(admin) {
    var schools = buildMapSchools();
    var cities = {}; schools.forEach(function (s) { if (s.city) cities[s.city] = (cities[s.city] || 0) + 1; });
    var experts = {};
    if (admin) fullFups().forEach(function (f) { if (f && f.Expert) { var g = readEntryGeo(f); if (g && g.has) experts[canonicalPersonName(f.Expert)] = 1; } });
    var nPrecise = schools.filter(function (s) { return s.precise; }).length;
    var h = '<div class="c27-card">'
      + '<div class="c27-klabel">Carte interactive · OpenStreetMap</div>'
      + '<h3>Écoles sur la carte</h3>'
      + '<p class="c27-sub">Recherchez une école par son nom ou sa zone. Marqueur plein = position GPS réelle (relevée lors d\'une saisie) ; marqueur pâle = position approximative au centre de la ville, précisée automatiquement à la première visite géolocalisée. ' + _fmt(nPrecise) + ' position(s) précise(s) sur ' + _fmt(schools.length) + ' écoles cartographiées.</p>'
      + '<div class="c27-filters">'
      + '<input type="search" placeholder="🔎 École, quartier, repère…" value="' + _attr(_mapState.q) + '" oninput="c27MapFilter(\'q\',this.value)">'
      + '<select onchange="c27MapFilter(\'city\',this.value)"><option value="">Toutes les villes</option>' + Object.keys(cities).sort().map(function (c) { return '<option' + (_mapState.city === c ? ' selected' : '') + ' value="' + _attr(c) + '">' + _esc(c) + ' (' + cities[c] + ')</option>'; }).join('') + '</select>'
      + '<select onchange="c27MapFilter(\'stage\',this.value)"><option value="">Tous les statuts</option><option value="gagne"' + (_mapState.stage === 'gagne' ? ' selected' : '') + '>🏆 Signées</option>' + Object.keys(STAGE_LABEL).map(function (s) { return '<option' + (_mapState.stage === s ? ' selected' : '') + ' value="' + s + '">' + STAGE_LABEL[s] + '</option>'; }).join('') + '</select>'
      + '<select onchange="c27MapFilter(\'precise\',this.value)"><option value="">GPS + approximatives</option><option value="1"' + (_mapState.precise === '1' ? ' selected' : '') + '>📍 Positions GPS seulement</option></select>'
      + '<select onchange="c27MapFilter(\'osm\',this.value)">'
      + '<option value=""' + (!_mapState.osm ? ' selected' : '') + '>Nos écoles seulement</option>'
      + '<option value="1"' + (_mapState.osm === '1' ? ' selected' : '') + '>🌐 + écoles trouvées sur Internet</option>'
      + '<option value="new"' + (_mapState.osm === 'new' ? ' selected' : '') + '>🆕 À prospecter seulement (Internet)</option></select>'
      + '<button id="c27OsmBtn" class="c27-act" onclick="c27LoadOsm()">🌐 Charger les écoles Internet de ' + _esc((_mapState.city || 'DOUALA')) + '</button>'
      + '</div>'
      + '<div id="c27MapBox" style="height:480px;border-radius:16px;overflow:hidden;border:1px solid var(--g200);background:var(--g50)"><div class="c27-empty">Chargement de la carte…</div></div>'
      + '<div id="c27MapCount" class="c27-muted" style="margin-top:10px"></div>'
      + '<div class="c27-note">Légende — nos écoles : <b style="color:#047857">●</b> signée · <b style="color:#DC2626">●</b> chaude · <b style="color:#D97706">●</b> tiède · <b style="color:#2563EB">●</b> nouvelle · <b style="color:#78716C">●</b> froide · <b style="color:#44403C">●</b> perdue · écoles Internet : <b style="color:#7C3AED">◆</b> à prospecter, <b style="color:#A78BFA">◇</b> déjà dans notre base. « Effectif » = nombre d\'élèves déclaré lors de la prospection ; « Standing » = niveau de frais de scolarité estimé par le prospecteur (de Très basse à Très haute). Les écoles Internet (maternelles, primaires, secondaires, universités) proviennent d\'OpenStreetMap, la base cartographique mondiale communautaire — les pages Facebook ne peuvent pas être aspirées automatiquement : une école repérée sur Facebook s\'ajoute en la saisissant une fois, elle apparaîtra ensuite sur la carte.</div>'
      + '</div>';
    if (admin) {
      h += '<div class="c27-card"><div class="c27-klabel">Suivi terrain · Super Admin & Admins</div>'
        + '<h3>🥾 Tournées des prospecteurs</h3>'
        + '<p class="c27-sub">Affiche sur la carte les points GPS des saisies d\'un prospecteur, numérotés dans l\'ordre chronologique et reliés par son parcours : vous voyez où il est réellement passé, quand, et la distance parcourue (calculée à vol d\'oiseau entre points successifs — distance de Haversine).</p>'
        + '<div class="c27-filters">'
        + '<select onchange="c27MapTrack(\'expert\',this.value)"><option value="">— Choisir un prospecteur —</option>' + Object.keys(experts).sort().map(function (e2) { return '<option' + (_mapState.expert === e2 ? ' selected' : '') + ' value="' + _attr(e2) + '">' + _esc(e2) + '</option>'; }).join('') + '</select>'
        + '<select onchange="c27MapTrack(\'period\',this.value)">'
        + '<option value="today"' + (_mapState.period === 'today' ? ' selected' : '') + '>Aujourd\'hui</option>'
        + '<option value="7d"' + (_mapState.period === '7d' ? ' selected' : '') + '>7 derniers jours</option>'
        + '<option value="30d"' + (_mapState.period === '30d' ? ' selected' : '') + '>30 derniers jours</option>'
        + '<option value="c27"' + (_mapState.period === 'c27' ? ' selected' : '') + '>Toute la campagne</option></select>'
        + '</div>'
        + '<div id="c27TrackInfo" class="c27-muted"></div>'
        + '</div>';
    }
    return h;
  }

  function initMap() {
    var box = document.getElementById('c27MapBox');
    if (!box) return;
    ensureLeaflet(function () {
      box.innerHTML = '';
      var center = CITY_COORDS['DOUALA'];
      _map = L.map(box, { scrollWheelZoom: true, preferCanvas: true }).setView(center, 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(_map);
      _mapLayer = L.layerGroup().addTo(_map);
      _trackLayer = L.layerGroup().addTo(_map);
      refreshMapMarkers();
      refreshTrack();
    });
  }

  function refreshMapMarkers() {
    if (!_map || !_mapLayer) return;
    _mapLayer.clearLayers();
    var q = normalizeText(_mapState.q || '');
    var list = buildMapSchools().filter(function (s) {
      if (_mapState.city && s.city !== _mapState.city) return false;
      if (_mapState.stage && s.stage !== _mapState.stage) return false;
      if (_mapState.precise === '1' && !s.precise) return false;
      if (q) {
        var hay = normalizeText([s.name, s.quartier, s.location, s.city].join(' '));
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var bounds = [];
    var photos = schoolPhotoIndex();
    list.forEach(function (s) {
      var color = STAGE_COLOR[s.stage] || '#2563EB';
      var photo = photos[s.key] || null;
      var mk = L.circleMarker(s.pos, {
        radius: s.precise ? 9 : 7,
        color: color, weight: s.precise ? 2.5 : 1.5,
        fillColor: color, fillOpacity: s.precise ? 0.85 : 0.3,
        dashArray: s.precise ? null : '3,4'
      });
      var pop = '<div style="font-family:\'DM Sans\',sans-serif;min-width:230px;max-width:280px">'
        + (photo ? '<img src="' + photo.data + '" style="width:100%;max-height:110px;object-fit:cover;border-radius:10px;margin-bottom:7px" alt="Photo école">' : '')
        + '<div style="font-weight:800;font-size:14px;margin-bottom:3px">' + _esc(s.name) + '</div>'
        + '<div style="font-size:11px;color:#78716C;margin-bottom:8px">' + _esc(s.city) + (s.quartier ? ' · ' + _esc(s.quartier) : '') + (s.location ? ' · ' + _esc(s.location) : '') + (s.precise ? '' : ' · <i>position approximative</i>') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;margin-bottom:8px">'
        + '<div>📶 <b>' + (STAGE_LABEL[s.stage] || (s.stage === 'gagne' ? '🏆 Signée' : s.stage)) + '</b></div>'
        + '<div>🎯 Taux : <b>' + (s.rate != null ? s.rate + '%' : '—') + '</b></div>'
        + '<div>👩‍🎓 Élèves : <b>' + (s.effectif ? _fmt(s.effectif) : '—') + '</b></div>'
        + '<div>🏷 Standing : <b>' + (s.standing ? _esc(s.standing) : '—') + '</b></div>'
        + '<div>🏫 ' + (s.type ? _esc(s.type) : '—') + '</div>'
        + '<div>👑 ' + (s.owner ? _esc(s.owner) : 'Libre') + '</div>'
        + '</div>'
        + (s.contact || s.phone ? '<div style="font-size:12px;margin-bottom:8px">' + _esc(s.contact || '') + (s.phone ? ' · <a href="tel:' + _attr(s.phone) + '">' + _esc(s.phone) + '</a>' : '') + '</div>' : '')
        + '<div style="display:flex;gap:6px">'
        + '<button onclick="c27StartEntry(' + jsArg(s.name) + ',' + jsArg(s.city) + ',' + jsArg(s.contact) + ',' + jsArg(s.phone) + ')" style="flex:1;background:#1C1917;color:#F4EBD6;border:none;border-radius:8px;padding:7px;font-weight:700;cursor:pointer">✍️ Saisir</button>'
        + (s.phone ? '<a href="tel:' + _attr(s.phone) + '" style="flex:1;text-align:center;border:1px solid #E7E5E4;border-radius:8px;padding:7px;text-decoration:none;color:#1C1917;font-weight:700">📞</a>' : '')
        + '</div></div>';
      mk.bindPopup(pop);
      mk.addTo(_mapLayer);
      bounds.push(s.pos);
    });
    // — Écoles découvertes sur Internet (OpenStreetMap) —
    var osmShown = 0, osmNew = 0;
    if (_mapState.osm) {
      var city = (_mapState.city || 'DOUALA').toUpperCase();
      var discovered = discoveredForCity(city);
      if (discovered.length) {
        // index de rapprochement : école connue → jetons de nom significatifs
        var ourIdx = {};
        buildMapSchools().forEach(function (s) { ourIdx[s.name] = osmNameTokens(s.name); });
        discovered.forEach(function (d) {
          var known = osmMatchesOurs(d.name, ourIdx);
          if (_mapState.osm === 'new' && known) return;
          if (q) {
            var hay2 = normalizeText([d.name, d.kind, d.quartier, d.operator].join(' '));
            if (hay2.indexOf(q) === -1) return;
          }
          osmShown++;
          if (!known) osmNew++;
          var col = known ? '#A78BFA' : '#7C3AED';
          var mk2 = L.circleMarker([d.lat, d.lng], {
            radius: known ? 6 : 8, color: col, weight: 2,
            fillColor: col, fillOpacity: known ? 0.25 : 0.7
          });
          var pop2 = '<div style="font-family:\'DM Sans\',sans-serif;min-width:220px;max-width:270px">'
            + '<div style="font-weight:800;font-size:14px;margin-bottom:3px">' + _esc(d.name) + '</div>'
            + '<div style="font-size:11px;color:#7C3AED;font-weight:700;margin-bottom:6px">🌐 Trouvée sur Internet (OpenStreetMap) — ' + _esc(d.kind) + '</div>'
            + '<div style="font-size:12px;line-height:1.7;margin-bottom:8px">'
            + (known ? '🔗 Correspond à notre école « <b>' + _esc(known) + '</b> »' : '🆕 <b>Pas encore prospectée par NATEIVA</b>')
            + (d.quartier ? '<br>📍 ' + _esc(d.quartier) : '')
            + (d.operator ? '<br>🏛 ' + _esc(d.operator) : '')
            + (d.capacity ? '<br>👩‍🎓 Capacité estimée : ' + _esc(d.capacity) : '')
            + (d.phone ? '<br>📞 <a href="tel:' + _attr(d.phone) + '">' + _esc(d.phone) + '</a>' : '')
            + '</div>'
            + (known ? '' : '<button onclick="c27StartEntry(' + jsArg(d.name) + ',' + jsArg(city) + ',\'\',' + jsArg(d.phone || '') + ')" style="width:100%;background:#7C3AED;color:#fff;border:none;border-radius:8px;padding:8px;font-weight:700;cursor:pointer">✍️ Prospecter cette école</button>')
            + '</div>';
          mk2.bindPopup(pop2);
          mk2.addTo(_mapLayer);
          bounds.push([d.lat, d.lng]);
        });
      }
    }
    var count = document.getElementById('c27MapCount');
    if (count) {
      var txt = list.length + ' école(s) de notre base affichée(s)' + (_mapState.q ? ' pour « ' + _mapState.q + ' »' : '');
      if (_mapState.osm) txt += ' · 🌐 ' + osmShown + ' école(s) Internet dont ' + osmNew + ' à prospecter';
      count.textContent = txt;
    }
    if (bounds.length) { try { _map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 }); } catch (e) { } }
  }

  function refreshTrack() {
    if (!_map || !_trackLayer) return;
    _trackLayer.clearLayers();
    var info = document.getElementById('c27TrackInfo');
    if (!_mapState.expert) { if (info) info.textContent = ''; return; }
    var now = Date.now();
    var from = _mapState.period === 'today' ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      : _mapState.period === '7d' ? now - 7 * 86400000
        : _mapState.period === '30d' ? now - 30 * 86400000
          : START_MS;
    var pts = fullFups().filter(function (f) {
      if (!f || !samePerson(f.Expert, _mapState.expert)) return false;
      var m = tsMs(f.Timestamp);
      if (m == null || m < from) return false;
      var g = readEntryGeo(f);
      return g && g.has;
    }).map(function (f) {
      var g = readEntryGeo(f);
      return { lat: g.lat, lng: g.lng, ts: tsMs(f.Timestamp), school: f.SchoolName || '', type: f.FollowupType || '' };
    }).sort(function (a, b) { return a.ts - b.ts; });
    if (!pts.length) { if (info) info.textContent = 'Aucun point GPS pour ' + _mapState.expert + ' sur cette période.'; return; }
    var km = 0, path = [];
    pts.forEach(function (p, i) {
      path.push([p.lat, p.lng]);
      if (i > 0) km += kmBetween(pts[i - 1], p);
      var mk = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: '',
          html: '<div style="background:#B08D2F;color:#fff;border:2px solid #fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font:700 12px \'DM Sans\',sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.3)">' + (i + 1) + '</div>',
          iconSize: [26, 26], iconAnchor: [13, 13]
        })
      });
      mk.bindPopup('<b>' + (i + 1) + '. ' + _esc(p.school) + '</b><br>' + new Date(p.ts).toLocaleString('fr-FR') + ' · ' + _esc(p.type));
      mk.addTo(_trackLayer);
    });
    L.polyline(path, { color: '#B08D2F', weight: 3, dashArray: '6,8', opacity: 0.8 }).addTo(_trackLayer);
    if (info) info.innerHTML = '<b>' + _esc(_mapState.expert) + '</b> : ' + pts.length + ' point(s) GPS · ~' + km.toFixed(1) + ' km parcourus (vol d\'oiseau entre points successifs) · du ' + new Date(pts[0].ts).toLocaleString('fr-FR') + ' au ' + new Date(pts[pts.length - 1].ts).toLocaleString('fr-FR');
    try { _map.fitBounds(path, { padding: [40, 40], maxZoom: 15 }); } catch (e) { }
  }

  /* ======================= 11. PHOTO TERRAIN OBLIGATOIRE ================== */
  // Pour toute VISITE terrain : une photo de l'école prise SUR PLACE, avec
  // l'appareil photo (capture="environment" ouvre directement la caméra sur
  // mobile). Une image choisie dans la galerie est rejetée : le fichier doit
  // dater de moins de 5 minutes. La photo est compressée (~560 px) et voyage
  // dans les métadonnées de la saisie ; l'heure de prise et la position GPS
  // sont enregistrées avec elle.
  var PHOTO_MAX_AGE_MS = 5 * 60 * 1000;
  var PHOTO_MAX_B64 = 45000; // la colonne notes (TEXT, 64 Ko) doit tout contenir avant la migration MEDIUMTEXT
  var _photoState = null;

  function photoRequired() {
    var sel = document.getElementById('fuType');
    if (!sel) return false;
    if (window.followupEditMode === 'edit') return false; // l'édition garde la photo d'origine
    return sel.value === 'VISIT';
  }

  function ensurePhotoField() {
    try {
      var notes = document.getElementById('fuNotes');
      if (!notes || document.getElementById('c27PhotoWrap')) { updatePhotoUi(); return; }
      var field = notes.closest ? notes.closest('.form-field') : null;
      if (!field || !field.parentNode) return;
      var wrap = document.createElement('div');
      wrap.className = 'form-field full';
      wrap.id = 'c27PhotoWrap';
      wrap.innerHTML = '<div style="background:linear-gradient(135deg,#F7F1E3,#FAFAF9);border:1.5px solid #B08D2F;border-radius:12px;padding:14px 16px">'
        + '<label style="font-weight:800;color:#7A5F1C;text-transform:uppercase;letter-spacing:.06em;font-size:11px">📸 Photo de l\'école <span id="c27PhotoReq" style="color:#B91C1C"></span></label>'
        + '<div style="font-size:12px;color:#78716C;margin:4px 0 10px">Prise sur place avec l\'appareil photo (façade ou plaque de l\'école). Les images de la galerie sont refusées.</div>'
        + '<input type="file" id="c27PhotoInput" accept="image/*" capture="environment" style="display:none">'
        + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
        + '<button type="button" class="c27-ask-btn" style="margin-top:0" onclick="document.getElementById(\'c27PhotoInput\').click()">📸 Prendre la photo</button>'
        + '<img id="c27PhotoPreview" style="display:none;height:64px;border-radius:9px;border:2px solid #B08D2F">'
        + '<span id="c27PhotoStatus" style="font-size:12.5px;font-weight:600;color:#78716C"></span>'
        + '</div></div>';
      field.parentNode.insertBefore(wrap, field.nextSibling);
      document.getElementById('c27PhotoInput').addEventListener('change', onPhotoPicked);
      updatePhotoUi();
    } catch (e) { }
  }

  function updatePhotoUi() {
    var wrap = document.getElementById('c27PhotoWrap');
    if (!wrap) return;
    var req = document.getElementById('c27PhotoReq');
    var needed = photoRequired();
    wrap.style.display = needed ? '' : 'none';
    if (req) req.textContent = needed ? '· OBLIGATOIRE pour une visite' : '';
  }

  var _pendingSubmit = false;

  function currentFormSchoolName() {
    try {
      var sel = document.getElementById('fuSchool');
      if (!sel) return '';
      if (sel.value === '__other__') { var c = document.getElementById('fuSchoolCustom'); return c ? c.value : ''; }
      return sel.value || '';
    } catch (e) { return ''; }
  }

  // --- OCR (Optical Character Recognition) : lire le nom de l'école sur la photo ---
  function ensureTesseract(cb) {
    if (window.Tesseract) return cb(true);
    var sc = document.getElementById('c27-tess-js');
    if (sc) { sc.addEventListener('load', function () { cb(!!window.Tesseract); }); return; }
    sc = document.createElement('script');
    sc.id = 'c27-tess-js';
    sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    sc.onload = function () { cb(!!window.Tesseract); };
    sc.onerror = function () { cb(false); };
    document.head.appendChild(sc);
  }
  function ocrMatchSchool(text, schoolName) {
    var hay = normalizeText(text || '').replace(/[^a-z0-9 ]/g, ' ');
    var toks = osmNameTokens(schoolName || '');
    if (!hay.trim()) return { status: 'unreadable', score: 0 };
    if (!toks.length) return { status: 'unreadable', score: 0 };
    var found = 0, strong = false;
    toks.forEach(function (t) { if (hay.indexOf(t) > -1) { found++; if (t.length >= 4) strong = true; } });
    var score = Math.round(100 * found / toks.length);
    return { status: (score >= 40 || strong) ? 'match' : 'mismatch', score: score };
  }
  function runPhotoOcr(img, schoolName, done) {
    try {
      var scale = Math.min(1, 1000 / Math.max(img.width, img.height));
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * scale));
      cv.height = Math.max(1, Math.round(img.height * scale));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      var big = cv.toDataURL('image/jpeg', 0.8);
      ensureTesseract(function (ok) {
        if (!ok) return done({ status: 'unreadable', score: 0, text: '' });
        var finished = false;
        var to = setTimeout(function () { if (!finished) { finished = true; done({ status: 'unreadable', score: 0, text: '' }); } }, 30000);
        try {
          window.Tesseract.recognize(big, 'fra+eng').then(function (res) {
            if (finished) return; finished = true; clearTimeout(to);
            var text = (res && res.data && res.data.text) || '';
            var m = ocrMatchSchool(text, schoolName);
            m.text = text.replace(/\s+/g, ' ').trim().slice(0, 180);
            done(m);
          }).catch(function () { if (!finished) { finished = true; clearTimeout(to); done({ status: 'unreadable', score: 0, text: '' }); } });
        } catch (e) { if (!finished) { finished = true; clearTimeout(to); done({ status: 'unreadable', score: 0, text: '' }); } }
      });
    } catch (e) { done({ status: 'unreadable', score: 0, text: '' }); }
  }

  function onPhotoPicked(ev) {
    var file = ev.target.files && ev.target.files[0];
    var status = document.getElementById('c27PhotoStatus');
    var preview = document.getElementById('c27PhotoPreview');
    _photoState = null;
    if (preview) preview.style.display = 'none';
    if (!file) { if (status) status.textContent = ''; _pendingSubmit = false; return; }
    var age = Date.now() - (file.lastModified || 0);
    if (!(age >= -120000 && age <= PHOTO_MAX_AGE_MS)) {
      if (status) { status.textContent = '⛔ Photo refusée : elle doit être prise à l\'instant avec l\'appareil photo, pas choisie dans la galerie.'; status.style.color = '#B91C1C'; }
      ev.target.value = '';
      _pendingSubmit = false;
      return;
    }
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var dataUrl = '', fits = true;
      try {
        var quality = 0.55, size = 560;
        for (var attempt = 0; attempt < 4; attempt++) {
          var scale = Math.min(1, size / Math.max(img.width, img.height));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.width * scale));
          cv.height = Math.max(1, Math.round(img.height * scale));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          dataUrl = cv.toDataURL('image/jpeg', quality);
          if (dataUrl.length <= PHOTO_MAX_B64) break;
          quality -= 0.12; size -= 90;
        }
        fits = dataUrl.length <= PHOTO_MAX_B64;
      } catch (e) { dataUrl = ''; }
      if (preview && dataUrl) { preview.src = dataUrl; preview.style.display = ''; }
      if (status) { status.textContent = '🔍 Lecture du nom de l\'école sur la photo… (quelques secondes)'; status.style.color = '#B45309'; }
      var schoolName = currentFormSchoolName();
      runPhotoOcr(img, schoolName, function (ocr) {
        _photoState = {
          data: fits ? dataUrl : '',
          takenAt: new Date().toISOString(),
          fileAt: new Date(file.lastModified || Date.now()).toISOString(),
          bytes: file.size || 0,
          ocrStatus: ocr.status, ocrScore: ocr.score || 0, ocrText: ocr.text || ''
        };
        if (status) {
          if (ocr.status === 'match') { status.textContent = '✅ Photo vérifiée : le nom de l\'école est reconnu sur la photo (' + ocr.score + '% des mots retrouvés).'; status.style.color = '#047857'; }
          else if (ocr.status === 'mismatch') { status.textContent = '⚠️ Nom de l\'école non reconnu sur la photo — la visite sera soumise à vérification par votre admin.'; status.style.color = '#B45309'; }
          else { status.textContent = '📷 Panneau illisible sur la photo — la visite sera soumise à vérification par votre admin.'; status.style.color = '#B45309'; }
        }
        URL.revokeObjectURL(url);
        if (_pendingSubmit) { _pendingSubmit = false; setTimeout(function () { window.submitFollowup(); }, 400); }
      });
    };
    img.onerror = function () { if (status) { status.textContent = 'Fichier illisible — reprenez la photo.'; status.style.color = '#B91C1C'; } _pendingSubmit = false; URL.revokeObjectURL(url); };
    img.src = url;
  }

  // Verrou à l'enregistrement : pas de visite sans photo prise sur place.
  function installPhotoGate() {
    var orig = window.submitFollowup;
    if (typeof orig !== 'function' || orig.__c27PhotoGate) return;
    var wrapped = function () {
      if (photoRequired() && !_photoState) {
        if (typeof isSuperAdmin === 'function' && isSuperAdmin(window.currentUser)) {
          _toast('⚠️ Visite sans photo — autorisé pour le Super Admin uniquement');
          return orig.apply(this, arguments);
        }
        // Enregistrer → l'appareil photo s'ouvre ; après la photo (et sa
        // vérification), l'enregistrement repart automatiquement.
        ensurePhotoField();
        var wrap = document.getElementById('c27PhotoWrap');
        if (wrap) { wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        _pendingSubmit = true;
        var input = document.getElementById('c27PhotoInput');
        if (input) { input.click(); }
        _toast('📸 Prenez la photo de la façade ou de la plaque de l\'école pour enregistrer la visite');
        return;
      }
      return orig.apply(this, arguments);
    };
    wrapped.__c27PhotoGate = true;
    window.submitFollowup = wrapped;
  }

  function applyPhotoMeta(meta) {
    if (_photoState) {
      meta.photoAt = _photoState.takenAt;      // heure de prise de la photo
      meta.photoFileAt = _photoState.fileAt;   // horodatage du fichier (contrôle anti-galerie)
      meta.photoBytes = String(_photoState.bytes || 0);
      if (_photoState.data) meta.photoData = _photoState.data; // vignette JPEG compressée
      // Résultat OCR (lecture du nom de l'école sur la photo)
      meta.photoOcrStatus = _photoState.ocrStatus || 'unreadable';
      meta.photoOcrScore = String(_photoState.ocrScore || 0);
      if (_photoState.ocrText) meta.photoOcrText = _photoState.ocrText;
      if (meta.photoOcrStatus !== 'match') meta.photoReviewNeeded = '1'; // → revue par l'admin
      _photoState = null;
      var preview = document.getElementById('c27PhotoPreview');
      var status = document.getElementById('c27PhotoStatus');
      var input = document.getElementById('c27PhotoInput');
      if (preview) preview.style.display = 'none';
      if (status) status.textContent = '';
      if (input) input.value = '';
    }
    return meta;
  }

  /* ======================= 11b. REVUE DES PHOTOS (SUB ADMIN) ============== */
  // Les visites dont la photo n'a pas permis de reconnaître le nom de l'école
  // (nom non concordant ou panneau illisible) arrivent dans cette file. Le
  // Sub Admin / Super Admin assigné voit la photo, le texte lu par l'OCR, et
  // Valide ou Rejette ; la décision est enregistrée dans la saisie.
  var PHOTO_REVIEW_LS = 'nateiva_c27_photo_reviews';

  function entryMetaOf(f) {
    try { return splitFollowupNotes(f.Notes).meta || {}; } catch (e) { return {}; }
  }
  function buildPhotoReviewList() {
    var localDecisions = lsGet(PHOTO_REVIEW_LS, {});
    var superA = (typeof isSuperAdmin === 'function') && isSuperAdmin(window.currentUser);
    return fullVisibleFups().filter(function (f) {
      if (!f || !f.ID) return false;
      var m = entryMetaOf(f);
      if (!(m.photoReviewNeeded === '1' && !m.photoReview && !localDecisions[f.ID])) return false;
      // Un Sub Admin prospecte aussi : il ne peut pas valider SES PROPRES
      // visites — elles remontent au Super Admin.
      if (!superA && samePerson(f.Expert, _me())) return false;
      return true;
    }).map(function (f) {
      var m = entryMetaOf(f);
      return {
        id: f.ID, ts: tsMs(f.Timestamp), expert: canonicalPersonName(f.Expert), school: f.SchoolName || '',
        city: f.City || '', photo: m.photoData || '', ocrStatus: m.photoOcrStatus || 'unreadable',
        ocrScore: m.photoOcrScore || '0', ocrText: m.photoOcrText || '', photoAt: m.photoAt || ''
      };
    }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  }

  window.c27ReviewPhoto = function (id, decision) {
    var entry = fullFups().filter(function (f) { return f && String(f.ID) === String(id); })[0];
    if (!entry) { _toast('Saisie introuvable', true); return; }
    // Garde-fou : on ne décide jamais sur sa propre visite (sauf Super Admin).
    if (samePerson(entry.Expert, _me()) && !((typeof isSuperAdmin === 'function') && isSuperAdmin(window.currentUser))) {
      _toast('Vos propres visites sont vérifiées par le Super Admin', true);
      return;
    }
    var split = splitFollowupNotes(entry.Notes);
    var meta = split.meta || {};
    meta.photoReview = decision;                       // 'ok' | 'rejected'
    meta.photoReviewBy = _me();
    meta.photoReviewAt = new Date().toISOString();
    var marker = (typeof FOLLOWUP_META_MARKER === 'string') ? FOLLOWUP_META_MARKER : '[NATEIVA_META]';
    var newNotes = (split.text ? split.text + '\n' : '') + marker + JSON.stringify(meta);
    var body = {
      timestamp: entry.Timestamp, expert: entry.Expert, schoolName: entry.SchoolName,
      contactName: entry.ContactName || '', contactPhone: entry.ContactPhone || '',
      followupType: entry.FollowupType || 'FOLLOWUP', notes: newNotes,
      outcome: entry.Outcome || '', nextAction: entry.NextAction || '', nextDate: entry.NextDate || '',
      cost: entry.Cost || 0, status: entry.Status || 'En cours', city: entry.City || '',
      sector: entry.Sector || '', schoolType: entry.SchoolType || '', category: entry.Category || '',
      effectif: entry.Effectif || '', location: entry.Location || '', contactRole: entry.ContactRole || ''
    };
    var localDecisions = lsGet(PHOTO_REVIEW_LS, {});
    localDecisions[id] = { decision: decision, by: _me(), at: new Date().toISOString() };
    lsSet(PHOTO_REVIEW_LS, localDecisions);
    if (typeof backendRequest === 'function' && typeof isBackendConfigured === 'function' && isBackendConfigured() && window.nateivaApiToken) {
      backendRequest('/api/followups/' + encodeURIComponent(id), { method: 'PUT', body: body })
        .then(function (res) {
          _toast(res && res.success ? (decision === 'ok' ? 'Visite validée ✓' : 'Visite rejetée — signalée dans le score de confiance') : 'Décision gardée sur cet appareil (synchronisation impossible)', !(res && res.success));
          repaint();
        })
        .catch(function () { _toast('Décision gardée sur cet appareil (hors-ligne)'); repaint(); });
    } else {
      _toast('Décision gardée sur cet appareil (hors-ligne)');
      repaint();
    }
  };

  function renderPhotoReviewQueue() {
    var list = buildPhotoReviewList();
    var h = '<div class="c27-card"><div class="c27-klabel">Contrôle photo · Sub Admin & Super Admin</div>'
      + '<h3>📸 Visites à vérifier (' + list.length + ')</h3>'
      + '<p class="c27-sub">Le système lit le nom de l\'école sur la photo prise sur place (OCR = Optical Character Recognition, lecture automatique du texte). Quand le nom lu ne correspond pas à l\'école saisie, ou que le panneau est illisible, la visite arrive ici pour décision. « % des mots retrouvés » = mots significatifs du nom de l\'école retrouvés dans le texte lu ÷ mots significatifs totaux. Un Sub Admin qui prospecte ne voit jamais ses propres visites ici : elles sont vérifiées par le Super Admin.</p>';
    if (!list.length) {
      h += '<div class="c27-empty">✨ Aucune visite en attente de vérification.</div></div>';
      return h;
    }
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px">';
    list.slice(0, 30).forEach(function (r) {
      h += '<div style="border:1px solid var(--g200);border-radius:14px;overflow:hidden;background:var(--paper)">'
        + (r.photo ? '<img src="' + r.photo + '" style="width:100%;height:130px;object-fit:cover" alt="Photo école">' : '<div class="c27-empty" style="padding:18px">Pas de vignette (photo lourde — attestation seule)</div>')
        + '<div style="padding:12px 14px">'
        + '<div class="c27-school">' + _esc(r.school) + '</div>'
        + '<div class="c27-muted">' + _esc(r.expert) + ' · ' + (r.ts ? new Date(r.ts).toLocaleDateString('fr-FR') + ' ' + new Date(r.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—') + (r.city ? ' · ' + _esc(r.city) : '') + '</div>'
        + '<div style="margin:8px 0"><span class="c27-chip ' + (r.ocrStatus === 'mismatch' ? 'pend' : 'froid') + '">' + (r.ocrStatus === 'mismatch' ? '⚠️ Nom non concordant (' + _esc(r.ocrScore) + '%)' : '📷 Panneau illisible') + '</span></div>'
        + (r.ocrText ? '<div class="c27-flag">Texte lu : « ' + _esc(r.ocrText) + ' »</div>' : '')
        + '<div style="display:flex;gap:8px;margin-top:10px">'
        + '<button class="c27-act primary" style="flex:1" onclick="c27ReviewPhoto(' + jsArg(r.id) + ',\'ok\')">✅ Valider</button>'
        + '<button class="c27-act" style="flex:1" onclick="c27ReviewPhoto(' + jsArg(r.id) + ',\'rejected\')">⛔ Rejeter</button>'
        + '</div></div></div>';
    });
    h += '</div>'
      + (list.length > 30 ? '<div class="c27-muted" style="margin-top:10px">' + (list.length - 30) + ' autres en attente…</div>' : '')
      + '<div class="c27-note">Valider = visite authentique (le signal est levé). Rejeter = visite douteuse : elle reste signalée et pèse sur le score de confiance du prospecteur. La décision est enregistrée dans la saisie (nom du décideur + date).</div></div>';
    return h;
  }

  /* ======================= 12. RAPPORT « GPS NON AUTORISÉ » =============== */
  // Qui n'autorise pas la géolocalisation ? Pour chaque prospecteur : combien
  // de saisies terrain sans position, lesquelles ont explicitement REFUSÉ la
  // permission, avec dates, heures et écoles — exportable en CSV.
  function computeGpsRefusals(scopeAll) {
    var rows = {};
    fullFups().forEach(function (f) {
      if (!f || !f.Timestamp || !f.Expert) return;
      var isField = f.FollowupType === 'VISIT' || f.FollowupType === 'PROSPECTION';
      if (!isField) return;
      if (!scopeAll && !inCampaign(f.Timestamp)) return;
      var name = canonicalPersonName(f.Expert);
      var r = rows[name] = rows[name] || { expert: name, field: 0, noGps: 0, denied: 0, entries: [], firstAt: null, lastAt: null };
      r.field++;
      var geo = readEntryGeo(f);
      var status = geo ? String(geo.status || '') : '';
      if (geo && geo.has) return;
      r.noGps++;
      var isDenied = status.indexOf('denied') > -1;
      if (isDenied) r.denied++;
      var ms = tsMs(f.Timestamp);
      if (ms != null) {
        if (r.firstAt == null || ms < r.firstAt) r.firstAt = ms;
        if (r.lastAt == null || ms > r.lastAt) r.lastAt = ms;
      }
      r.entries.push({ ts: ms, school: f.SchoolName || '', type: f.FollowupType || '', status: isDenied ? 'Permission REFUSÉE' : (status.indexOf('none') > -1 ? 'Position indisponible' : 'Aucune position enregistrée') });
    });
    return Object.keys(rows).map(function (k) { return rows[k]; })
      .filter(function (r) { return r.noGps > 0; })
      .map(function (r) { r.coverage = r.field ? Math.round(100 * (r.field - r.noGps) / r.field) : null; r.entries.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }); return r; })
      .sort(function (a, b) { return b.denied - a.denied || b.noGps - a.noGps; });
  }

  function renderGpsRefusalReport(scopeAll) {
    var data = computeGpsRefusals(scopeAll);
    var h = '<div class="c27-card"><div class="c27-klabel">Permission de géolocalisation</div>'
      + '<h3>🚫 Prospecteurs sans suivi GPS</h3>'
      + '<p class="c27-sub">Saisies terrain (visites/descentes) enregistrées SANS position, par prospecteur. « Permission REFUSÉE » = le téléphone a explicitement bloqué la géolocalisation au moment de la saisie ; « Position indisponible » = délai dépassé ou signal absent (tunnel, intérieur). Couverture GPS = saisies terrain avec position ÷ saisies terrain totales.</p>'
      + '<div class="c27-filters"><button class="c27-act" onclick="c27ExportGpsRefusals()">⬇️ Export CSV (dates & heures)</button></div>';
    if (!data.length) {
      h += '<div class="c27-empty">🎉 Aucune saisie terrain sans position sur la période.</div></div>';
      return h;
    }
    h += '<div style="overflow-x:auto"><table class="c27-tbl"><thead><tr><th>Prospecteur</th><th>Saisies terrain</th><th>Sans GPS</th><th>Permission refusée</th><th>Couverture GPS</th><th>Du — au</th><th>Détail</th></tr></thead><tbody>';
    data.forEach(function (r) {
      h += '<tr><td class="c27-school">' + _esc(r.expert) + '</td>'
        + '<td>' + _fmt(r.field) + '</td>'
        + '<td><b>' + _fmt(r.noGps) + '</b> <span class="c27-muted">(' + Math.round(100 * r.noGps / r.field) + '%)</span></td>'
        + '<td>' + (r.denied ? '<b style="color:var(--red)">' + _fmt(r.denied) + '</b>' : '0') + '</td>'
        + '<td>' + (r.coverage == null ? '—' : r.coverage + '%') + '</td>'
        + '<td class="c27-muted">' + (r.firstAt ? new Date(r.firstAt).toLocaleDateString('fr-FR') : '—') + ' — ' + (r.lastAt ? new Date(r.lastAt).toLocaleDateString('fr-FR') : '—') + '</td>'
        + '<td><details class="c27-det"><summary>' + r.entries.length + ' saisie(s)</summary>'
        + r.entries.slice(0, 40).map(function (e) {
          return '<div class="c27-flag">' + (e.ts ? new Date(e.ts).toLocaleDateString('fr-FR') + ' à ' + new Date(e.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—')
            + ' · <b>' + _esc(e.school) + '</b> · ' + _esc(e.type) + ' · ' + e.status + '</div>';
        }).join('') + '</details></td></tr>';
    });
    h += '</tbody></table></div>'
      + '<div class="c27-note">À faire appliquer : la géolocalisation doit être autorisée sur le téléphone professionnel pendant les heures de tournée. Un refus répété pèse aussi sur le Score de confiance ci-dessous (-' + CFG.TRUST.weights.noGps + ' pts max).</div></div>';
    return h;
  }
  window.c27ExportGpsRefusals = function () {
    var scope = lsGet(LS_KEYS.trustScope, campaignStarted() ? 'c27' : 'all');
    var data = computeGpsRefusals(scope === 'all');
    var rows = [['Prospecteur', 'Date', 'Heure', 'Ecole', 'Type', 'Statut GPS']];
    data.forEach(function (r) {
      r.entries.forEach(function (e) {
        rows.push([r.expert, e.ts ? new Date(e.ts).toLocaleDateString('fr-FR') : '', e.ts ? new Date(e.ts).toLocaleTimeString('fr-FR') : '', e.school, e.type, e.status]);
      });
    });
    downloadCsv('nateiva-gps-non-autorise.csv', rows);
  };

  /* ======================= 13. NAVIGATION SIMPLIFIÉE + ACCÈS CARTE ======== */
  // Un bouton « 🗺 Carte » de premier niveau ouvre directement la carte des
  // écoles. Pour les prospecteurs (non-admins), la navigation est allégée aux
  // onglets essentiels ; les admins et le Super Admin gardent tout.
  var EXPERT_HIDDEN_PANES = { metrics: 1, market: 1, playbook: 1, intel: 1, glossary: 1 };

  window.c27OpenMap = function () {
    lsSet(LS_KEYS.tab, 'map');
    var btn = document.querySelector('.nav-btn[data-pane="c27"]');
    if (btn) btn.click(); else { if (window._paneDirty) window._paneDirty.c27 = true; rC27(); }
    setTimeout(rC27, 80);
  };

  function injectMapShortcut() {
    try {
      if (!document.getElementById('c27MapNavBtn')) {
        var ref = document.querySelector('.nav-btn[data-pane="c27"]');
        if (ref && ref.parentNode) {
          var b = document.createElement('button');
          b.className = 'nav-btn'; b.id = 'c27MapNavBtn';
          b.innerHTML = '<span class="nav-icon">🗺</span><span class="nav-label">Carte</span><span class="nav-desc">Écoles & Terrain</span>';
          b.onclick = function () { window.c27OpenMap(); };
          ref.parentNode.insertBefore(b, ref.nextSibling);
        }
      }
      if (!document.getElementById('c27MapTabBtn')) {
        var refT = document.querySelector('.bottom-tab[data-pane="c27"]');
        if (refT && refT.parentNode) {
          var t = document.createElement('button');
          t.className = 'bottom-tab'; t.id = 'c27MapTabBtn';
          t.innerHTML = '<span class="bt-icon">🗺</span><span class="bt-label">Carte</span>';
          t.onclick = function () { window.c27OpenMap(); };
          refT.parentNode.insertBefore(t, refT.nextSibling);
        }
      }
    } catch (e) { }
  }

  function applyNavSimplification() {
    try {
      var u = window.currentUser;
      var isAdmin = u && (typeof canSeeAllData === 'function') && canSeeAllData(u);
      document.querySelectorAll('.nav-btn[data-pane], .bottom-tab[data-pane]').forEach(function (el) {
        var key = el.dataset ? el.dataset.pane : '';
        if (!EXPERT_HIDDEN_PANES[key]) return;
        el.style.display = (u && !isAdmin) ? 'none' : '';
      });
    } catch (e) { }
  }

  /* ======================= 7. BRANCHEMENTS (HOOKS) ======================== */
  function boot() {
    injectCss();
    injectStripCss();
    // 1. Périmètre annuel : filtre global des données + sélecteur d'année.
    installScopeWrappers();
    injectScopePill();
    // Le pill doit survivre aux re-rendus de l'en-tête (login/logout).
    setInterval(injectScopePill, 4000);
    // Enregistrement du pane dans le registre des rendus + état « à rafraîchir ».
    try {
      if (window._paneDirty) window._paneDirty.c27 = true;
      if (typeof window._getPaneRenderers === 'function') {
        var m = window._getPaneRenderers();
        if (m && !m.c27) m.c27 = rC27;
      }
    } catch (e) { }
    // 2. Bandeau « cette année vs N-1 » sur les onglets clés.
    wrapPaneRenderers();
    markAllDirty();
    // 3. Photo terrain obligatoire + raccourci Carte + navigation allégée.
    installPhotoGate();
    injectMapShortcut();
    applyNavSimplification();
    setInterval(function () { injectMapShortcut(); applyNavSimplification(); }, 4000);
    document.addEventListener('change', function (ev) {
      if (ev.target && ev.target.id === 'fuType') { ensurePhotoField(); updatePhotoUi(); }
    }, true);
    // Capture GPS : au chargement (si connecté), à l'activation du Workspace et du pane 2027.
    if (window.currentUser) geoCapture('boot');
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-pane]') : null;
      if (!btn) return;
      var pane = btn.dataset ? btn.dataset.pane : '';
      if (pane === 'suivi') { geoCapture('workspace'); markFormOpened(); setTimeout(ensurePhotoField, 250); }
      if (pane === 'c27') { geoCapture('c27'); setTimeout(rC27, 50); }
    }, true);
    // Ouverture du panneau « Nouveau suivi » → horodatage du formulaire.
    var _origActivate = window.activateSuiviPanel;
    if (typeof _origActivate === 'function') {
      window.activateSuiviPanel = function (key, opts) {
        if (key === 'add') { markFormOpened(); setTimeout(ensurePhotoField, 200); }
        return _origActivate(key, opts);
      };
    }
    flushPendingRequests();
  }
  // Points d'entrée internes pour les tests automatisés (sans effet en prod).
  window.__c27Test = { buildMapSchools: buildMapSchools, buildStripHtml: buildStripHtml, scopeActive: scopeActive, osmMatchesOurs: osmMatchesOurs, osmNameTokens: osmNameTokens, osmKindOf: osmKindOf, computeGpsRefusals: computeGpsRefusals, photoRequired: photoRequired, setPhoto: function (p) { _photoState = p; }, renderGpsRefusalReport: renderGpsRefusalReport, ocrMatchSchool: ocrMatchSchool, buildPhotoReviewList: buildPhotoReviewList, renderPhotoReviewQueue: renderPhotoReviewQueue };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
