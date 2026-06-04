(() => {
  if (window.__NATEIVA_REDESIGN_INIT__) return;
  window.__NATEIVA_REDESIGN_INIT__ = true;
  const RAW_DATA = typeof RAW !== "undefined" ? RAW : (window.RAW || []);
  const COMPETITOR_DATA = typeof COMPETITORS !== "undefined" ? COMPETITORS : (window.COMPETITORS || []);
  const TIPS_DATA = typeof TIPS !== "undefined" ? TIPS : (window.TIPS || {});
  const IMPORTED_DATA = window.NATEIVA_IMPORTED_DATA || {};
  if (!Array.isArray(RAW_DATA)) return;

  const ROOT_ID = "nateiva-redesign-root";
  const STYLE_ID = "nateiva-redesign-style";
  const USER_KEY = "nateiva_user";
  const FOLLOWUPS_KEY = "nateiva_followups";
  const PROSPECTS_KEY = "nateiva_dynamic_prospects_v2";
  const ROUTE_KEY = "nateiva_redesign_route";
  const WORKSPACE_TAB_KEY = "nateiva_redesign_workspace_tab";
  const SCOPE_KEY = "nateiva_redesign_scope";
  const FILTERS_KEY = "nateiva_redesign_filters";
  const COMBINED_ALLOWED = new Set(["noah", "guy", "brice", "mbeuka", "mbeuka brice", "ntsa guy"]);
  const SOURCE_LINKS = {
    prospectionSheet: IMPORTED_DATA.sources?.prospectionSheet || "https://docs.google.com/spreadsheets/d/1Ng5N2LhCA6_4AScc9HmJASMsd3Br1siPwPX6spgJMu0/edit?resourcekey=&gid=1811644632#gid=1811644632",
    callsSheet: IMPORTED_DATA.sources?.callsSheet || "https://docs.google.com/spreadsheets/d/1SuXKmpD6I8XOUqi1sw8SD_osBT0zPjGTyLVux5DNOMI/edit?resourcekey=&gid=559073092#gid=559073092"
  };
  const SOURCE_COUNTS = {
    prospection: Number(IMPORTED_DATA.prospectionCount) || (Array.isArray(IMPORTED_DATA.prospection) ? IMPORTED_DATA.prospection.length : 0),
    calls: Number(IMPORTED_DATA.callCount) || (Array.isArray(IMPORTED_DATA.calls) ? IMPORTED_DATA.calls.length : 0)
  };
  const GLOSSARY_ITEMS = [
    { title: "Vélocité", description: "Inputs ÷ jours actifs distincts", use: "Mesure réelle de rythme journalier par expert." },
    { title: "Jours actifs", description: "Nombre de dates distinctes avec au moins une saisie", use: "Base de calcul pour la vélocité et les comparaisons." },
    { title: "Hot Rate", description: "Chauds + gagnés ÷ portefeuille visible", use: "Indique la qualité immédiate du pipeline." },
    { title: "Pipeline chaud", description: "Écoles proches de signer", use: "Priorité pour démonstration, dépôt dossier et closing." },
    { title: "Programme Ambassadeur", description: "Commission différenciante NATEIVA", use: "Levier fort face aux concurrents locaux et cloud-only." },
    { title: "Bloqué hiérarchie", description: "Le directeur transmet au fondateur / à la fondation", use: "Signal culturel normal à traiter avec patience." },
    { title: "Revenu probable", description: "Projection FCFA par état du pipeline", use: "Aide au forecast commercial et à la priorisation." },
    { title: "Carte scolaire MINESEC", description: "Conformité et modernisation 2024-2026", use: "Argument de transformation pour les établissements." }
  ];
  const PLAYBOOK_RULES = [
    { title: "10 écoles / jour", copy: "Planifier par corridor géographique et garder des visites courtes." },
    { title: "Démo instantanée", copy: "Montrer le produit sur téléphone dès qu’un intérêt apparaît." },
    { title: "Dossier physique", copy: "Laisser brochure, offre et pièces utiles avant la relance." },
    { title: "Respect de la hiérarchie", copy: "Le directeur est l’allié qui ouvre la porte du fondateur." },
    { title: "WhatsApp J+1", copy: "Relancer chaudement le lendemain avec un message personnalisé." },
    { title: "Argument offline + souveraineté", copy: "Insister sur la continuité et la conservation locale des données." }
  ];
  let IMPORTED_FOLLOWUPS = [];
  const DEFAULT_USERS = Array.isArray(window.DEFAULT_USERS) && window.DEFAULT_USERS.length
    ? window.DEFAULT_USERS
    : [
        { username: "ivan", password: "ivan123", fullName: "Ivan", role: "Expert", city: "DOUALA" },
      { username: "fabiola", password: "fabiola123", fullName: "Kendo Fabiola", role: "Expert", city: "DOUALA" },
      { username: "ida", password: "ida123", fullName: "Emambo Ida", role: "Expert", city: "DOUALA" },
      { username: "guy", password: "guy123", fullName: "Ntsa Guy", role: "SuperAdmin", city: "YAOUNDE" },
      { username: "brice", password: "brice123", fullName: "Mbeuka brice", role: "SuperAdmin", city: "DOUALA" },
      { username: "taylor", password: "taylor123", fullName: "Kessi Taylor", role: "Expert", city: "YAOUNDE" },
      { username: "kessie", password: "kessie123", fullName: "Kessi Taylor", role: "Expert", city: "YAOUNDE" },
      { username: "noah", password: "noah2026", fullName: "Noah", role: "SuperAdmin", city: "ALL" }
    ];
  const STAGES = [
    { key: "gagne", label: "Gagnes", color: "green" },
    { key: "chaud", label: "Chauds", color: "red" },
    { key: "tiede", label: "Tiedes", color: "amber" },
    { key: "froid", label: "Froids", color: "ink" },
    { key: "nouveau", label: "Nouveau", color: "teal" },
    { key: "perdu", label: "Perdus", color: "slate" }
  ];
  const TIER_ORDER = { MAJOR: 0, CHALLENGER: 1, REGIONAL: 2, GLOBAL: 3, MINOR: 4 };
  const persistedFilters = parseJson(localStorage.getItem(FILTERS_KEY), {});
  const state = {
    currentUser: loadUser(),
    route: localStorage.getItem(ROUTE_KEY) || "dashboard",
    workspaceTab: localStorage.getItem(WORKSPACE_TAB_KEY) || "new-entry",
    scope: localStorage.getItem(SCOPE_KEY) === "combined" ? "combined" : "personal",
    city: persistedFilters.city || "",
    zone: persistedFilters.zone || "",
    stage: persistedFilters.stage || "",
    search: persistedFilters.search || "",
    loginError: "",
    loggingIn: false,
    pendingFollowupSchool: ""
  };

  applyImportedData();
  hydrateDynamicProspects();
  injectStyles();
  mountRoot();
  bindRootEvents();
  render();
  syncRemoteFollowups();

  function parseJson(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function loadUser() {
    if (window.currentUser) return window.currentUser;
    return parseJson(localStorage.getItem(USER_KEY), null);
  }

  function getStoredFollowups() {
    if (Array.isArray(window.suiviFollowups)) return window.suiviFollowups;
    window.suiviFollowups = parseJson(localStorage.getItem(FOLLOWUPS_KEY), []);
    return window.suiviFollowups;
  }

  function setStoredFollowups(list) {
    window.suiviFollowups = list.slice();
    localStorage.setItem(FOLLOWUPS_KEY, JSON.stringify(window.suiviFollowups));
  }

  function getFollowups() {
    return IMPORTED_FOLLOWUPS.concat(getStoredFollowups());
  }

  function setCurrentUser(user) {
    state.currentUser = user;
    window.currentUser = user;
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
    if (canSeeCombined(user)) state.scope = "combined";
    else state.scope = "personal";
    persistNav();
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function sameName(a, b) {
    return normalize(a) === normalize(b);
  }

  function canSeeCombined(user) {
    if (!user) return false;
    return COMBINED_ALLOWED.has(normalize(user.fullName)) || COMBINED_ALLOWED.has(normalize(user.username));
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (match) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[match]));
  }

  function attr(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  function money(value) {
    return `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(value) || 0))} FCFA`;
  }

  function num(value) {
    return new Intl.NumberFormat("fr-FR").format(Math.round(Number(value) || 0));
  }

  function percent(value) {
    return `${Math.round(Number(value) || 0)}%`;
  }

  function pctBadge(value) {
    if (value == null || value === "") return `<span class="ntv-rate ntv-rate-empty">--</span>`;
    const n = Number(value) || 0;
    const tone = n >= 60 ? "hot" : n >= 30 ? "warm" : "cold";
    return `<span class="ntv-rate ntv-rate-${tone}">${n}%</span>`;
  }

  function toDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateTime(value) {
    const date = toDate(value);
    if (!date) return "--";
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function shortDate(value) {
    const date = toDate(value);
    if (!date) return "--";
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short"
    }).format(date);
  }

  function phoneHref(phone) {
    const digits = String(phone || "").replace(/[^\d+]/g, "");
    return digits ? `tel:${digits}` : "";
  }

  function activeDayKey(value) {
    const date = toDate(value);
    if (!date) return "";
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function zoneOf(row) {
    if (!row) return "";
    return row.v === "YAOUNDE" ? (row.sy || "") : (row.sd || "");
  }

  function schoolKey(name) {
    return normalize(name);
  }

  function estimateDealValue(record) {
    const standing = normalize(record.standing);
    if (standing.includes("tres haute")) return 70000;
    if (standing.includes("haute")) return 65000;
    if (standing.includes("tres basse")) return 50000;
    return 60000;
  }

  function stageMeta(key) {
    return STAGES.find((stage) => stage.key === key) || STAGES[0];
  }

  function applyImportedData() {
    const importedProspection = Array.isArray(IMPORTED_DATA.prospection) ? IMPORTED_DATA.prospection : [];
    if (importedProspection.length) {
      RAW_DATA.splice(0, RAW_DATA.length, ...importedProspection.map((row, index) => ({
        ...row,
        __imported: true,
        __importId: `IMP-PROS-${index + 1}`
      })));
    }

    const schoolMeta = new Map();
    RAW_DATA.forEach((row) => {
      const key = schoolKey(row.n);
      if (!key) return;
      if (!schoolMeta.has(key)) {
        schoolMeta.set(key, { city: row.v || "", zone: zoneOf(row) || "" });
        return;
      }
      const current = schoolMeta.get(key);
      schoolMeta.set(key, {
        city: current.city || row.v || "",
        zone: current.zone || zoneOf(row) || ""
      });
    });

    IMPORTED_FOLLOWUPS = (Array.isArray(IMPORTED_DATA.calls) ? IMPORTED_DATA.calls : []).map((call, index) => {
      const key = schoolKey(call.school);
      const meta = schoolMeta.get(key) || {};
      const nextAction = [
        call.secondCall ? "Second appel" : "",
        call.whatsappDocs ? "Docs WhatsApp" : "",
        call.toSuperior ? "Transmission supérieur" : "",
        call.visit ? "Visite sur site" : ""
      ].filter(Boolean).join(" · ");
      return {
        ID: `IMP-CALL-${index + 1}`,
        Timestamp: call.timestamp || call.date || "",
        Expert: call.expert || "",
        SchoolName: call.school || "",
        ContactName: call.contact || "",
        ContactPhone: call.phone || "",
        FollowupType: "CALL",
        Notes: call.summary || "",
        Outcome: call.status || "",
        NextAction: nextAction,
        NextDate: call.nextDate || "",
        Cost: 0,
        Status: call.status || "",
        City: call.city || meta.city || "",
        Sector: meta.zone || "",
        Source: "calls-sheet",
        Imported: true,
        Rating: call.rating || "",
        Duration: call.duration || "",
        TimesCalled: call.timesCalled || ""
      };
    });
  }

  function determineStage(record) {
    const latestFollowup = record.latestFollowup;
    const status = normalize(latestFollowup && latestFollowup.Status);
    const outcome = normalize(latestFollowup && latestFollowup.Outcome);
    if (status === "converti" || outcome.includes("converti") || outcome.includes("sign")) return "gagne";
    if (status === "termine" || outcome.includes("pas interesse") || outcome.includes("perdu")) return "perdu";
    const rate = record.rate == null ? null : Number(record.rate);
    if (rate == null || rate === 0) return "nouveau";
    if (rate >= 60) return "chaud";
    if (rate >= 30) return "tiede";
    return "froid";
  }

  function getUsers() {
    if (typeof window.getAllUsers === "function") {
      try {
        return window.getAllUsers();
      } catch (error) {
        return DEFAULT_USERS;
      }
    }
    return DEFAULT_USERS.concat(parseJson(localStorage.getItem("nateiva_invited_users"), []));
  }

  function hydrateDynamicProspects() {
    const dynamicRows = parseJson(localStorage.getItem(PROSPECTS_KEY), []);
    dynamicRows.forEach((row) => {
      if (!RAW_DATA.some((existing) => existing.__localId && existing.__localId === row.__localId)) {
        RAW_DATA.push(row);
      }
    });
  }

  function persistDynamicProspect(row) {
    const stored = parseJson(localStorage.getItem(PROSPECTS_KEY), []);
    stored.push(row);
    localStorage.setItem(PROSPECTS_KEY, JSON.stringify(stored));
    RAW_DATA.push(row);
  }

  function getScopedRaw(user, scope) {
    if (!user) return [];
    if (scope === "combined" && canSeeCombined(user)) return RAW_DATA.slice();
    return RAW_DATA.filter((row) => sameName(row.e, user.fullName));
  }

  function getScopedFollowups(user, scope) {
    if (!user) return [];
    const allFollowups = getFollowups();
    if (scope === "combined" && canSeeCombined(user)) return allFollowups.slice();
    return allFollowups.filter((item) => sameName(item.Expert, user.fullName));
  }

  function buildSchoolRecords(rawRows, followups) {
    const records = new Map();
    rawRows
      .slice()
      .sort((a, b) => (toDate(a.t) || 0) - (toDate(b.t) || 0))
      .forEach((row) => {
        const key = schoolKey(row.n);
        if (!key) return;
        if (!records.has(key)) {
          records.set(key, {
            key,
            schoolName: row.n || "Sans nom",
            rawEntries: [],
            followups: [],
            contactNames: new Set(),
            phones: new Set(),
            roles: new Set(),
            bestRate: null
          });
        }
        const record = records.get(key);
        record.rawEntries.push(row);
        record.latest = row;
        record.expert = row.e || record.expert || "";
        record.city = row.v || record.city || "";
        record.zone = zoneOf(row) || record.zone || "";
        record.standing = row.ca || record.standing || "";
        record.type = row.ty || record.type || "";
        record.location = row.lo || record.location || "";
        record.rate = row.r == null ? record.rate : Number(row.r);
        record.bestRate = row.r == null ? record.bestRate : Math.max(record.bestRate == null ? row.r : record.bestRate, Number(row.r));
        record.effectif = Number(row.ef) || record.effectif || 0;
        if (row.rn) record.contactNames.add(row.rn);
        if (row.rp) record.roles.add(row.rp);
        if (row.pw) record.phones.add(row.pw);
        if (row.pn) record.phones.add(row.pn);
        if (row.co) record.comment = row.co;
        if (row.re) record.remark = row.re;
      });

    followups
      .slice()
      .sort((a, b) => (toDate(a.Timestamp) || 0) - (toDate(b.Timestamp) || 0))
      .forEach((entry) => {
        const key = schoolKey(entry.SchoolName);
        if (!key) return;
        if (!records.has(key)) {
          records.set(key, {
            key,
            schoolName: entry.SchoolName || "Sans nom",
            rawEntries: [],
            followups: [],
            contactNames: new Set(),
            phones: new Set(),
            roles: new Set(),
            bestRate: null
          });
        }
        const record = records.get(key);
        record.followups.push(entry);
        record.latestFollowup = entry;
        record.expert = entry.Expert || record.expert || "";
        record.city = entry.City || record.city || "";
        record.zone = entry.Sector || record.zone || "";
        if (entry.ContactName) record.contactNames.add(entry.ContactName);
        if (entry.ContactPhone) record.phones.add(entry.ContactPhone);
        if (entry.Notes) record.followupNote = entry.Notes;
      });

    return Array.from(records.values())
      .map((record) => {
        const phone = Array.from(record.phones)[0] || "";
        const contactName = Array.from(record.contactNames)[0] || "";
        const role = Array.from(record.roles)[0] || "";
        const followupCalls = record.followups.filter((item) => item.FollowupType === "CALL").length;
        const fieldVisits = record.rawEntries.length + record.followups.filter((item) => item.FollowupType === "VISIT").length;
        const updatedAt = record.latestFollowup ? record.latestFollowup.Timestamp : (record.latest ? record.latest.t : "");
        const normalized = {
          ...record,
          contactName,
          role,
          phone,
          callCount: followupCalls,
          fieldVisitCount: fieldVisits,
          followupCount: record.followups.length,
          updatedAt,
          dealValue: estimateDealValue(record)
        };
        normalized.stage = determineStage(normalized);
        normalized.stageMeta = stageMeta(normalized.stage);
        return normalized;
      })
      .sort((a, b) => {
        const delta = (toDate(b.updatedAt) || 0) - (toDate(a.updatedAt) || 0);
        if (delta !== 0) return delta;
        return (Number(b.rate) || 0) - (Number(a.rate) || 0);
      });
  }

  function filterRecords(records) {
    return records.filter((record) => {
      if (state.city && record.city !== state.city) return false;
      if (state.zone && record.zone !== state.zone) return false;
      if (state.stage && record.stage !== state.stage) return false;
      if (state.search) {
        const query = normalize(state.search);
        const haystack = [
          record.schoolName,
          record.contactName,
          record.expert,
          record.zone,
          record.city,
          record.standing
        ].map(normalize).join(" ");
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function buildPipeline(records) {
    const total = records.length || 1;
    return STAGES.map((stage) => {
      const schools = records.filter((record) => record.stage === stage.key);
      const amount = schools.reduce((sum, record) => sum + record.dealValue, 0);
      return {
        ...stage,
        schools,
        count: schools.length,
        percent: Math.round((schools.length / total) * 100),
        amount
      };
    });
  }

  function weekStart(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    const day = copy.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + offset);
    return copy;
  }

  function weekKey(date) {
    return weekStart(date).toISOString().slice(0, 10);
  }

  function weekLabel(date) {
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(date);
  }

  function buildWeeklySeries(rawRows, followups, weeksBack = 8) {
    const now = new Date();
    const currentWeek = weekStart(now);
    const weeks = [];
    for (let index = weeksBack - 1; index >= 0; index -= 1) {
      const start = new Date(currentWeek);
      start.setDate(start.getDate() - (index * 7));
      weeks.push({
        key: weekKey(start),
        label: weekLabel(start),
        start,
        terrain: 0,
        calls: 0,
        total: 0,
        hot: 0,
        schools: new Set(),
        activeDates: new Set(),
        delta: 0
      });
    }

    const weekMap = new Map(weeks.map((item) => [item.key, item]));
    rawRows.forEach((row) => {
      const date = toDate(row.t);
      if (!date) return;
      const bucket = weekMap.get(weekKey(date));
      if (!bucket) return;
      bucket.terrain += 1;
      bucket.activeDates.add(activeDayKey(date));
      if (Number(row.r) >= 60) bucket.hot += 1;
      if (row.n) bucket.schools.add(schoolKey(row.n));
    });
    followups.forEach((entry) => {
      const date = toDate(entry.Timestamp);
      if (!date) return;
      const bucket = weekMap.get(weekKey(date));
      if (!bucket) return;
      bucket.activeDates.add(activeDayKey(date));
      if (entry.FollowupType === "CALL") bucket.calls += 1;
      if (entry.FollowupType === "VISIT") bucket.terrain += 1;
      if (entry.SchoolName) bucket.schools.add(schoolKey(entry.SchoolName));
    });

    return weeks.map((bucket, index) => {
      const total = bucket.terrain + bucket.calls;
      const previous = index > 0 ? weeks[index - 1] : null;
      const previousTotal = previous ? previous.terrain + previous.calls : 0;
      return {
        ...bucket,
        total,
        schools: bucket.schools.size,
        activeDays: bucket.activeDates.size,
        velocity: bucket.activeDates.size ? (total / bucket.activeDates.size) : 0,
        delta: total - previousTotal
      };
    });
  }

  function buildVelocityModel(rawRows, followups) {
    const allEvents = [];
    rawRows.forEach((row) => {
      if (toDate(row.t)) allEvents.push({ timestamp: row.t, type: "terrain" });
    });
    followups.forEach((item) => {
      if (toDate(item.Timestamp)) {
        allEvents.push({
          timestamp: item.Timestamp,
          type: item.FollowupType === "CALL" ? "call" : "followup"
        });
      }
    });
    const activeDays = new Set(allEvents.map((item) => activeDayKey(item.timestamp)).filter(Boolean));
    const terrainDays = new Set(rawRows.map((row) => activeDayKey(row.t)).filter(Boolean));
    const callEvents = followups.filter((item) => item.FollowupType === "CALL");
    const callDays = new Set(callEvents.map((item) => activeDayKey(item.Timestamp)).filter(Boolean));
    return {
      totalInputs: allEvents.length,
      terrainInputs: rawRows.length,
      callInputs: callEvents.length,
      activeDays: activeDays.size,
      terrainActiveDays: terrainDays.size,
      callActiveDays: callDays.size,
      velocity: activeDays.size ? (allEvents.length / activeDays.size) : 0,
      terrainVelocity: terrainDays.size ? (rawRows.length / terrainDays.size) : 0,
      callVelocity: callDays.size ? (callEvents.length / callDays.size) : 0
    };
  }

  function buildExpertVelocityRows(rawRows, followups) {
    const experts = Array.from(new Set(
      rawRows.map((row) => row.e).concat(followups.map((item) => item.Expert)).filter(Boolean)
    ));
    return experts
      .map((expert) => {
        const expertRows = rawRows.filter((row) => sameName(row.e, expert));
        const expertFollowups = followups.filter((item) => sameName(item.Expert, expert));
        const velocity = buildVelocityModel(expertRows, expertFollowups);
        const lastInput = expertRows
          .map((row) => row.t)
          .concat(expertFollowups.map((item) => item.Timestamp))
          .map((value) => toDate(value))
          .filter(Boolean)
          .sort((a, b) => b - a)[0];
        return {
          expert,
          ...velocity,
          lastInput: lastInput ? lastInput.toISOString() : "",
          schools: new Set(expertRows.map((row) => schoolKey(row.n)).filter(Boolean)).size
        };
      })
      .sort((a, b) => b.velocity - a.velocity || b.totalInputs - a.totalInputs);
  }

  function buildAreaLayers(records) {
    const cities = new Map();
    const zones = new Map();
    records.forEach((record) => {
      const cityKey = record.city || "NON DEFINI";
      const zoneKey = `${cityKey}::${record.zone || "Sans zone"}`;
      if (!cities.has(cityKey)) {
        cities.set(cityKey, { city: cityKey, count: 0, won: 0, hot: 0, zones: new Map() });
      }
      if (!zones.has(zoneKey)) {
        zones.set(zoneKey, { city: cityKey, zone: record.zone || "Sans zone", count: 0, won: 0, hot: 0, warm: 0, experts: new Set() });
      }
      const city = cities.get(cityKey);
      const zone = zones.get(zoneKey);
      city.count += 1;
      zone.count += 1;
      zone.experts.add(record.expert);
      city.zones.set(zone.zone, (city.zones.get(zone.zone) || 0) + 1);
      if (record.stage === "gagne") {
        city.won += 1;
        zone.won += 1;
      }
      if (record.stage === "chaud") {
        city.hot += 1;
        zone.hot += 1;
      }
      if (record.stage === "tiede") zone.warm += 1;
    });

    return {
      cities: Array.from(cities.values())
        .map((item) => ({
          ...item,
          topZone: Array.from(item.zones.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "--",
          hotRate: item.count ? Math.round(((item.hot + item.won) / item.count) * 100) : 0
        }))
        .sort((a, b) => b.count - a.count),
      zones: Array.from(zones.values())
        .map((item) => ({
          ...item,
          hotRate: item.count ? Math.round(((item.hot + item.won) / item.count) * 100) : 0,
          expertCount: item.experts.size
        }))
        .sort((a, b) => b.count - a.count)
    };
  }

  function strengthRank(regions, city) {
    if (!city) return 99;
    const hit = (regions || []).find((region) => region.startsWith(city));
    if (!hit) return 99;
    if (hit.includes("FORT")) return 0;
    if (hit.includes("MOYEN")) return 1;
    if (hit.includes("FAIBLE")) return 2;
    return 3;
  }

  function buildCompetitors(cityFilter) {
    const city = cityFilter || "";
    return COMPETITOR_DATA
      .slice()
      .sort((a, b) => {
        const strength = strengthRank(a.regions, city) - strengthRank(b.regions, city);
        if (strength !== 0) return strength;
        return (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9);
      });
  }

  function buildAgentProgress(rawRows, followups) {
    const experts = Array.from(new Set(rawRows.map((row) => row.e).filter(Boolean)));
    return experts
      .map((expert) => {
        const expertRows = rawRows.filter((row) => sameName(row.e, expert));
        const expertFollowups = followups.filter((item) => sameName(item.Expert, expert));
        const series = buildWeeklySeries(expertRows, expertFollowups, 4);
        const velocity = buildVelocityModel(expertRows, expertFollowups);
        const current = series[series.length - 1] || { terrain: 0, calls: 0, total: 0, delta: 0 };
        const previous = series[series.length - 2] || { total: 0 };
        return {
          expert,
          series,
          current,
          previous,
          trend: current.total - previous.total,
          schools: new Set(expertRows.map((row) => schoolKey(row.n))).size,
          velocity
        };
      })
      .sort((a, b) => b.current.total - a.current.total);
  }

  function computeRankings(rawRows, followups) {
    const experts = Array.from(new Set(rawRows.map((row) => row.e).filter(Boolean)));
    return experts
      .map((expert) => {
        const expertRows = rawRows.filter((row) => sameName(row.e, expert));
        const expertFollowups = followups.filter((item) => sameName(item.Expert, expert));
        const schools = buildSchoolRecords(expertRows, expertFollowups);
        const hot = schools.filter((record) => record.stage === "chaud").length;
        const won = schools.filter((record) => record.stage === "gagne").length;
        const calls = expertFollowups.filter((item) => item.FollowupType === "CALL").length;
        const visits = expertRows.length + expertFollowups.filter((item) => item.FollowupType === "VISIT").length;
        const velocity = buildVelocityModel(expertRows, expertFollowups);
        const score = (won * 45) + (hot * 18) + (calls * 4) + visits;
        return {
          expert,
          schools: schools.length,
          hot,
          won,
          calls,
          visits,
          score,
          velocity: velocity.velocity,
          activeDays: velocity.activeDays
        };
      })
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function buildDashboardModel(user) {
    const scope = state.scope === "combined" && canSeeCombined(user) ? "combined" : "personal";
    const rawRows = getScopedRaw(user, scope);
    const followups = getScopedFollowups(user, scope);
    const allRecords = buildSchoolRecords(rawRows, followups);
    const cityPool = state.city ? allRecords.filter((record) => record.city === state.city) : allRecords;
    const cityOptions = Array.from(new Set(allRecords.map((record) => record.city).filter(Boolean))).sort();
    const zoneOptions = Array.from(new Set(cityPool.map((record) => record.zone).filter(Boolean))).sort();
    if (state.zone && !zoneOptions.includes(state.zone)) state.zone = "";

    const filteredRecords = filterRecords(allRecords);
    const allowedKeys = new Set(filteredRecords.map((record) => record.key));
    const filteredRaw = rawRows.filter((row) => allowedKeys.has(schoolKey(row.n)));
    const filteredFollowups = followups.filter((entry) => allowedKeys.has(schoolKey(entry.SchoolName)));
    const pipeline = buildPipeline(filteredRecords);
    const weekly = buildWeeklySeries(filteredRaw, filteredFollowups, 8);
    const velocity = buildVelocityModel(filteredRaw, filteredFollowups);
    const layers = buildAreaLayers(filteredRecords);
    const wonDeals = filteredRecords.filter((record) => record.stage === "gagne");
    const compareCurrent = weekly[weekly.length - 1] || { terrain: 0, calls: 0, total: 0, delta: 0 };
    const comparePrevious = weekly[weekly.length - 2] || { terrain: 0, calls: 0, total: 0 };
    const competitors = buildCompetitors(state.city || (scope === "personal" ? user.city : ""));
    const coach = (TIPS_DATA.by_expert || []).find((item) => sameName(item.expert, user.fullName));
    const stageGroups = STAGES.map((stage) => ({
      ...stage,
      schools: filteredRecords.filter((record) => record.stage === stage.key)
    }));
    const hotCount = pipeline.find((item) => item.key === "chaud")?.count || 0;
    const wonCount = pipeline.find((item) => item.key === "gagne")?.count || 0;
    const warmCount = pipeline.find((item) => item.key === "tiede")?.count || 0;
    const expertVelocity = buildExpertVelocityRows(rawRows, followups);
    return {
      scope,
      rawRows,
      followups,
      filteredRaw,
      filteredFollowups,
      allRecords,
      filteredRecords,
      cityOptions,
      zoneOptions,
      pipeline,
      weekly,
      layers,
      wonDeals,
      competitors,
      coach,
      hotCount,
      wonCount,
      warmCount,
      velocity,
      stageGroups,
      rankings: computeRankings(rawRows, followups),
      currentWeek: compareCurrent,
      previousWeek: comparePrevious,
      topZone: layers.zones[0]?.zone || "--",
      activeExperts: Array.from(new Set(rawRows.map((row) => row.e).concat(followups.map((item) => item.Expert)).filter(Boolean))).length,
      uniqueSchools: new Set(rawRows.map((row) => schoolKey(row.n)).filter(Boolean)).size,
      importedCalls: followups.filter((item) => item.Imported && item.FollowupType === "CALL").length,
      sourceStats: {
        terrainInputs: SOURCE_COUNTS.prospection || rawRows.length,
        callInputs: SOURCE_COUNTS.calls || followups.filter((item) => item.FollowupType === "CALL").length,
        sourceLinks: SOURCE_LINKS
      },
      expertVelocity,
      agentProgress: scope === "combined" ? buildAgentProgress(rawRows, followups) : [],
      glossary: GLOSSARY_ITEMS,
      playbookRules: PLAYBOOK_RULES
    };
  }

  function persistFilters() {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({
      city: state.city,
      zone: state.zone,
      stage: state.stage,
      search: state.search
    }));
  }

  function persistNav() {
    localStorage.setItem(ROUTE_KEY, state.route);
    localStorage.setItem(WORKSPACE_TAB_KEY, state.workspaceTab);
    localStorage.setItem(SCOPE_KEY, state.scope);
  }

  function mountRoot() {
    document.title = "Nateiva Sale Analytic";
    document.body.classList.add("ntv-body");
    document.body.innerHTML = `<div id="${ROOT_ID}"></div><div class="ntv-toast" id="ntv-toast"></div>`;
  }

  function root() {
    return document.getElementById(ROOT_ID);
  }

  function toast(message, isError = false) {
    const node = document.getElementById("ntv-toast");
    if (!node) return;
    node.textContent = message;
    node.className = `ntv-toast show${isError ? " error" : ""}`;
    setTimeout(() => {
      node.className = "ntv-toast";
    }, 3000);
  }

  async function apiCallShim(action, params) {
    if (typeof window.apiCall === "function") return window.apiCall(action, params);
    return localApi(action, params);
  }

  async function apiPostShim(payload) {
    if (typeof window.apiPost === "function") return window.apiPost(payload);
    return localApi(payload.action, payload);
  }

  function localApi(action, params) {
    switch (action) {
      case "login": {
        const user = getUsers().find((item) => item.username === params.user && item.password === params.pass);
        if (!user) return { success: false, error: "Identifiants incorrects" };
        return {
          success: true,
          user: {
            username: user.username,
            fullName: user.fullName,
            role: user.role || "Expert",
            city: user.city || "DOUALA"
          }
        };
      }
      case "getFollowups":
        return {
          success: true,
          followups: getStoredFollowups().filter((item) => !params.expert || sameName(item.Expert, params.expert))
        };
      case "getAllFollowups":
        return { success: true, followups: getStoredFollowups() };
      case "addFollowup": {
        const followup = {
          ID: `FU-${Date.now()}`,
          Timestamp: new Date().toISOString(),
          Expert: params.expert,
          SchoolName: params.schoolName,
          ContactName: params.contactName || "",
          ContactPhone: params.contactPhone || "",
          FollowupType: params.followupType,
          Notes: params.notes || "",
          Outcome: params.outcome || "",
          NextAction: params.nextAction || "",
          NextDate: params.nextDate || "",
          Cost: params.cost || 0,
          Status: params.status || "En cours",
          City: params.city || "",
          Sector: params.sector || ""
        };
        setStoredFollowups(getStoredFollowups().concat(followup));
        return { success: true, id: followup.ID, followup, message: "Suivi enregistre" };
      }
      default:
        return { success: false, error: `Action non geree: ${action}` };
    }
  }

  async function syncRemoteFollowups(force = false) {
    const user = state.currentUser;
    if (!user) return;
    if (typeof window.APPS_SCRIPT_URL !== "string" || window.APPS_SCRIPT_URL === "YOUR_APPS_SCRIPT_URL_HERE") return;
    const mode = state.scope === "combined" && canSeeCombined(user) ? "combined" : "personal";
    const syncKey = `${normalize(user.fullName)}::${mode}`;
    if (!force && state.lastSyncKey === syncKey) return;
    const response = mode === "combined"
      ? await apiCallShim("getAllFollowups")
      : await apiCallShim("getFollowups", { expert: user.fullName });
    if (!response || !response.success || !Array.isArray(response.followups)) return;
    if (mode === "combined") {
      setStoredFollowups(response.followups);
    } else {
      const others = getStoredFollowups().filter((item) => !sameName(item.Expert, user.fullName));
      setStoredFollowups(others.concat(response.followups));
    }
    state.lastSyncKey = syncKey;
    render();
  }

  function bindRootEvents() {
    document.addEventListener("click", async (event) => {
      const actionNode = event.target.closest("[data-action]");
      if (!actionNode) return;
      const action = actionNode.dataset.action;
      if (action === "logout") {
        setCurrentUser(null);
        state.loginError = "";
        state.route = "dashboard";
        render();
        return;
      }
      if (action === "route") {
        state.route = actionNode.dataset.route || "dashboard";
        persistNav();
        render();
        return;
      }
      if (action === "workspace-tab") {
        state.workspaceTab = actionNode.dataset.tab || "new-entry";
        persistNav();
        render();
        return;
      }
      if (action === "scope") {
        state.scope = actionNode.dataset.scope || "personal";
        persistNav();
        await syncRemoteFollowups(true);
        render();
        return;
      }
      if (action === "reset-filters") {
        state.city = "";
        state.zone = "";
        state.stage = "";
        state.search = "";
        persistFilters();
        render();
        return;
      }
      if (action === "prefill-followup") {
        state.route = "workspace";
        state.workspaceTab = "follow-up";
        state.pendingFollowupSchool = actionNode.dataset.school || "";
        persistNav();
        render();
        return;
      }
      if (action === "jump") {
        const targetId = actionNode.dataset.target;
        const target = targetId ? document.getElementById(targetId) : null;
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (action === "open-workspace") {
        state.route = "workspace";
        state.workspaceTab = actionNode.dataset.tab || "new-entry";
        persistNav();
        render();
      }
    });

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.id === "ntv-filter-city") {
        state.city = target.value;
        state.zone = "";
        persistFilters();
        render();
      }
      if (target.id === "ntv-filter-zone") {
        state.zone = target.value;
        persistFilters();
        render();
      }
      if (target.id === "ntv-filter-stage") {
        state.stage = target.value;
        persistFilters();
        render();
      }
      if (target.id === "followupSchool") {
        prefillFollowupForm(target.value);
      }
    });

    document.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.id === "ntv-filter-search") {
        state.search = target.value;
        persistFilters();
        render();
      }
    });

    document.addEventListener("submit", async (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      if (form.id === "ntv-login-form") {
        await submitLogin(form);
      }
      if (form.id === "ntv-new-entry-form") {
        await submitNewEntry(form);
      }
      if (form.id === "ntv-followup-form") {
        await submitFollowup(form);
      }
    });
  }

  async function submitLogin(form) {
    const user = form.username.value.trim().toLowerCase();
    const pass = form.password.value;
    if (!user || !pass) {
      state.loginError = "Veuillez remplir tous les champs.";
      render();
      return;
    }
    state.loggingIn = true;
    state.loginError = "";
    render();
    const response = await apiCallShim("login", { user, pass });
    state.loggingIn = false;
    if (!response || !response.success || !response.user) {
      state.loginError = response?.error || "Connexion impossible.";
      render();
      return;
    }
    setCurrentUser(response.user);
    state.route = "dashboard";
    state.workspaceTab = "new-entry";
    state.pendingFollowupSchool = "";
    persistNav();
    render();
    await syncRemoteFollowups(true);
    toast(`Bienvenue ${response.user.fullName}`);
  }

  async function submitNewEntry(form) {
    const user = state.currentUser;
    if (!user) return;
    const schoolName = form.schoolName.value.trim();
    if (!schoolName) {
      toast("Le nom de l'ecole est obligatoire.", true);
      return;
    }
    const city = form.city.value;
    const zone = form.zone.value.trim();
    const rateValue = form.rate.value === "" ? null : Number(form.rate.value);
    const row = {
      __localId: `RAW-${Date.now()}`,
      __local: true,
      t: new Date().toISOString(),
      e: user.fullName,
      n: schoolName,
      ty: form.schoolType.value,
      rn: form.contactName.value.trim(),
      rp: form.contactRole.value.trim(),
      pw: form.phonePrimary.value.trim(),
      pn: form.phoneSecondary.value.trim(),
      co: form.comment.value.trim(),
      tx: rateValue == null ? "" : `${rateValue}%`,
      r: rateValue,
      ef: form.effectif.value.trim(),
      ca: form.standing.value,
      v: city,
      sy: city === "YAOUNDE" ? zone : "",
      sd: city === "DOUALA" ? zone : "",
      lo: form.location.value.trim(),
      re: form.remark.value.trim()
    };
    persistDynamicProspect(row);
    state.pendingFollowupSchool = row.n;
    state.workspaceTab = "follow-up";
    persistNav();
    render();
    toast(`Nouvelle ecole ajoutee: ${row.n}`);
  }

  async function submitFollowup(form) {
    const user = state.currentUser;
    if (!user) return;
    const schoolName = form.schoolName.value.trim();
    if (!schoolName) {
      toast("Veuillez choisir une ecole.", true);
      return;
    }
    const payload = {
      action: "addFollowup",
      expert: user.fullName,
      schoolName,
      contactName: form.contactName.value.trim(),
      contactPhone: form.contactPhone.value.trim(),
      followupType: form.followupType.value,
      notes: form.notes.value.trim(),
      outcome: form.outcome.value,
      nextAction: form.nextAction.value.trim(),
      nextDate: form.nextDate.value,
      cost: form.followupType.value === "VISIT" ? (Number(form.cost.value) || 0) : 0,
      status: form.status.value,
      city: form.city.value,
      sector: form.zone.value.trim()
    };
    const existingLength = getStoredFollowups().length;
    const response = await apiPostShim(payload);
    if (!response || !response.success) {
      toast(response?.error || "Le suivi n'a pas pu etre enregistre.", true);
      return;
    }
    if (getStoredFollowups().length === existingLength) {
      const localItem = {
        ID: response.id || `FU-${Date.now()}`,
        Timestamp: new Date().toISOString(),
        Expert: payload.expert,
        SchoolName: payload.schoolName,
        ContactName: payload.contactName,
        ContactPhone: payload.contactPhone,
        FollowupType: payload.followupType,
        Notes: payload.notes,
        Outcome: payload.outcome,
        NextAction: payload.nextAction,
        NextDate: payload.nextDate,
        Cost: payload.cost,
        Status: payload.status,
        City: payload.city,
        Sector: payload.sector
      };
      setStoredFollowups(getStoredFollowups().concat(localItem));
    }
    form.reset();
    form.city.value = state.currentUser.city && state.currentUser.city !== "ALL" ? state.currentUser.city : "DOUALA";
    toast("Follow-up enregistre.");
    await syncRemoteFollowups(true);
    render();
  }

  function prefillFollowupForm(schoolName) {
    const school = buildSchoolRecords(getScopedRaw(state.currentUser, "personal"), getScopedFollowups(state.currentUser, "personal"))
      .find((item) => item.schoolName === schoolName);
    const form = document.getElementById("ntv-followup-form");
    if (!(form instanceof HTMLFormElement) || !school) return;
    form.schoolName.value = school.schoolName;
    form.contactName.value = school.contactName || "";
    form.contactPhone.value = school.phone || "";
    form.city.value = school.city || (state.currentUser.city !== "ALL" ? state.currentUser.city : "DOUALA");
    form.zone.value = school.zone || "";
  }

  function render() {
    const mount = root();
    if (!mount) return;
    if (!state.currentUser) {
      mount.innerHTML = renderLogin();
      return;
    }
    const dashboard = buildDashboardModel(state.currentUser);
    mount.innerHTML = `
      <div class="ntv-shell">
        ${renderHeader(state.currentUser, dashboard)}
        ${state.route === "dashboard" ? renderDashboard(state.currentUser, dashboard) : renderWorkspace(state.currentUser)}
      </div>
    `;
    if (state.pendingFollowupSchool && state.route === "workspace" && state.workspaceTab === "follow-up") {
      prefillFollowupForm(state.pendingFollowupSchool);
      state.pendingFollowupSchool = "";
    }
  }

  function renderLogin() {
    const totalSchools = SOURCE_COUNTS.prospection || RAW_DATA.length;
    const experts = new Set(RAW_DATA.map((row) => normalize(row.e)).filter(Boolean)).size;
    const zones = new Set(RAW_DATA.map((row) => `${row.v || ""}-${zoneOf(row) || ""}`).filter((value) => value !== "-")).size;
    return `
      <section class="ntv-login">
        <div class="ntv-brand-panel">
          <span class="ntv-kicker">NATEIVA Sales Analytics</span>
          <h1>Nateiva Sale Analytic .</h1>
          <p>Une seule entree pour le terrain, les appels, le suivi et le dashboard analytique par zone, pipeline, BI, playbook, NLP et concurrence.</p>
          <div class="ntv-stat-grid">
            <article class="ntv-stat-card"><strong>${num(totalSchools)}</strong><span>Prospections terrain</span></article>
            <article class="ntv-stat-card"><strong>${num(SOURCE_COUNTS.calls || 0)}</strong><span>Appels importes</span></article>
            <article class="ntv-stat-card"><strong>${num(experts)}</strong><span>Experts actifs</span></article>
            <article class="ntv-stat-card"><strong>${num(zones)}</strong><span>Couches zone/secteur</span></article>
            <article class="ntv-stat-card"><strong>${num(COMPETITOR_DATA.length)}</strong><span>Competiteurs traces</span></article>
          </div>
          <div class="ntv-login-note">Vue combinee reservee a Noah, Guy et Mbeuka. Tous les autres experts voient uniquement leurs propres donnees.</div>
        </div>
        <form class="ntv-login-card" id="ntv-login-form">
          <div class="ntv-card-top">
            <span class="ntv-card-kicker">🔐 Connexion</span>
            <h2>Acceder a votre compte</h2>
            <p>Choisissez ensuite votre dashboard analytique ou votre espace New Entry / Follow Up.</p>
          </div>
          <label class="ntv-field">
            <span>Utilisateur</span>
            <input type="text" name="username" autocomplete="username" placeholder="ex: guy">
          </label>
          <label class="ntv-field">
            <span>Mot de passe</span>
            <input type="password" name="password" autocomplete="current-password" placeholder="********">
          </label>
          ${state.loginError ? `<div class="ntv-form-error">${escapeHtml(state.loginError)}</div>` : ""}
          <button class="ntv-primary" type="submit">${state.loggingIn ? "Connexion..." : "Se connecter ✨"}</button>
        </form>
      </section>
    `;
  }

  function renderHeader(user, dashboard) {
    const personalActive = state.route === "dashboard";
    const canCombine = canSeeCombined(user);
    return `
      <header class="ntv-topbar">
        <div class="ntv-brand">
          <div class="ntv-brand-mark">N</div>
          <div>
            <span class="ntv-kicker">Nateiva Sale Analytic</span>
            <h2>Prospection premium par zone, pipeline, appels et compte expert</h2>
          </div>
        </div>
        <div class="ntv-top-actions">
          <button class="ntv-top-pill ${personalActive ? "active" : ""}" data-action="route" data-route="dashboard">📊 Dashboard</button>
          <button class="ntv-top-pill ${state.route === "workspace" ? "active" : ""}" data-action="route" data-route="workspace">📝 Workspace</button>
          <div class="ntv-user-box">
            <span class="ntv-user-name">${escapeHtml(user.fullName)}</span>
            <span class="ntv-user-meta">${escapeHtml(canCombine ? "Admin combine" : "Expert")} | ${escapeHtml(user.city || "ALL")}</span>
          </div>
          <button class="ntv-secondary" data-action="logout">🚪 Deconnexion</button>
        </div>
      </header>
      ${state.route === "dashboard" ? renderLegacyTabs(user) : ""}
      <section class="ntv-launch">
        <button class="ntv-launch-card ${state.route === "dashboard" ? "active" : ""}" data-action="route" data-route="dashboard">
          <span class="ntv-kicker">📊 Analytics</span>
          <strong>Insight Dashboard</strong>
          <p>Pipeline, revenus, progression hebdo, zones et concurrence.</p>
        </button>
        <button class="ntv-launch-card ${state.route === "workspace" ? "active" : ""}" data-action="route" data-route="workspace">
          <span class="ntv-kicker">📝 Execution</span>
          <strong>New Entry + Follow Up</strong>
          <p>Ajouter une nouvelle ecole, suivre les appels et garder l'historique.</p>
        </button>
        <div class="ntv-launch-summary">
          <div><strong>${num(dashboard.filteredRecords.length)}</strong><span>Ecoles visibles</span></div>
          <div><strong>${num(dashboard.hotCount + dashboard.wonCount)}</strong><span>Chaudes + gagnees</span></div>
          <div><strong>${escapeHtml(dashboard.topZone)}</strong><span>Zone dominante</span></div>
        </div>
      </section>
    `;
  }

  function renderLegacyTabs(user) {
    const locked = !canSeeCombined(user);
    const tabs = [
      { emoji: "🌍", label: "Combine", target: "dash-combine" },
      { emoji: "📊", label: "Pipeline", target: "dash-pipeline" },
      { emoji: "📘", label: "Journal", target: "dash-journal" },
      { emoji: "🏆", label: "Rang", target: "dash-rang" },
      { emoji: "📞", label: "Appels", target: "dash-appels" },
      { emoji: "🧠", label: "NLP", target: "dash-nlp" },
      { emoji: "👥", label: "Equipe", target: "dash-equipe" },
      { emoji: "👤", label: "Users", target: "dash-users" }
    ];
    return `
      <div class="ntv-legacy-tabs">
        ${tabs.map((tab) => `
          <button class="ntv-legacy-tab ${locked && tab.label === "Combine" ? "locked" : ""}" data-action="jump" data-target="${tab.target}">
            <span>${tab.emoji}</span>
            <strong>${tab.label}</strong>
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderDashboard(user, dashboard) {
    const hotPipeline = dashboard.pipeline.find((item) => item.key === "chaud")?.amount || 0;
    const warmPipeline = dashboard.pipeline.find((item) => item.key === "tiede")?.amount || 0;
    const wonPipeline = dashboard.pipeline.find((item) => item.key === "gagne")?.amount || 0;
    const hotRate = dashboard.filteredRecords.length ? Math.round(((dashboard.hotCount + dashboard.wonCount) / dashboard.filteredRecords.length) * 100) : 0;
    return `
      <main class="ntv-main">
        <section class="ntv-section" id="dash-combine">
          <div class="ntv-section-head">
            <div>
              <span class="ntv-kicker">${dashboard.scope === "combined" ? "Vue combinee" : "Vue personnelle"}</span>
              <h3>Dashboard analytique par zone, pipeline et semaine</h3>
              <p>Chaque expert voit ses propres donnees. Seuls Noah, Guy et Mbeuka peuvent activer la vue combinee de l'equipe.</p>
            </div>
            ${renderScopeSwitch(user, dashboard.scope)}
          </div>
          <div class="ntv-filter-bar">
            <label class="ntv-inline-field">
              <span>Ville</span>
              <select id="ntv-filter-city">${renderOptions(["", ...dashboard.cityOptions], state.city, "Toutes les villes")}</select>
            </label>
            <label class="ntv-inline-field">
              <span>Zone</span>
              <select id="ntv-filter-zone">${renderOptions(["", ...dashboard.zoneOptions], state.zone, "Toutes les zones")}</select>
            </label>
            <label class="ntv-inline-field">
              <span>Etape</span>
              <select id="ntv-filter-stage">${renderStageOptions(state.stage)}</select>
            </label>
            <label class="ntv-inline-field ntv-search">
              <span>Recherche</span>
              <input id="ntv-filter-search" type="text" value="${attr(state.search)}" placeholder="Ecole, contact, expert...">
            </label>
            <button class="ntv-ghost" data-action="reset-filters">Reset</button>
          </div>
          <div class="ntv-metric-grid">
            <article class="ntv-metric-card accent">
              <span class="ntv-kicker">Couverture</span>
              <strong>${num(dashboard.filteredRecords.length)}</strong>
              <p>Ecoles visibles dans cette vue.</p>
            </article>
            <article class="ntv-metric-card">
              <span class="ntv-kicker">Prospections</span>
              <strong>${num(dashboard.sourceStats.terrainInputs)}</strong>
              <p>Total charge depuis la feuille terrain.</p>
            </article>
            <article class="ntv-metric-card">
              <span class="ntv-kicker">Appels</span>
              <strong>${num(dashboard.sourceStats.callInputs)}</strong>
              <p>Appels importes et relies au pipeline.</p>
            </article>
            <article class="ntv-metric-card">
              <span class="ntv-kicker">Hot Rate</span>
              <strong>${percent(hotRate)}</strong>
              <p>Chauds + gagnes sur l'ensemble filtre.</p>
            </article>
            <article class="ntv-metric-card">
              <span class="ntv-kicker">Jours actifs</span>
              <strong>${num(dashboard.velocity.activeDays)}</strong>
              <p>Dates distinctes avec au moins une saisie.</p>
            </article>
            <article class="ntv-metric-card">
              <span class="ntv-kicker">Velocite</span>
              <strong>${dashboard.velocity.velocity.toFixed(1)}</strong>
              <p>Inputs par jour actif.</p>
            </article>
            <article class="ntv-metric-card">
              <span class="ntv-kicker">Cette semaine</span>
              <strong>${num(dashboard.currentWeek.total)}</strong>
              <p>${num(dashboard.currentWeek.terrain)} terrain | ${num(dashboard.currentWeek.calls)} appels | ${dashboard.currentWeek.velocity.toFixed(1)}/jour.</p>
            </article>
          </div>
        </section>

        <section class="ntv-section" id="dash-pipeline">
          <div class="ntv-section-head">
            <div>
              <span class="ntv-kicker">Pipeline</span>
              <h3>Entonnoir visuel et revenus</h3>
            </div>
          </div>
          <div class="ntv-pipeline-grid">
            ${dashboard.pipeline.map((stage) => renderStageMetric(stage)).join("")}
          </div>
          <div class="ntv-revenue-grid">
            ${renderRevenueCard("Revenu gagne", wonPipeline, "Valeur estimee des deals marques convertis.")}
            ${renderRevenueCard("Pipeline chaud", hotPipeline, "Projection immediate des ecoles les plus proches de signer.")}
            ${renderRevenueCard("Pipeline tiede", warmPipeline, "Base de relance a pousser avec demonstration et dossier.")}
          </div>
        </section>

        <section class="ntv-section" id="dash-journal">
          <div class="ntv-section-head">
            <div>
              <span class="ntv-kicker">Progression</span>
              <h3>Semaine par semaine</h3>
            </div>
            ${renderCompareCard(dashboard.currentWeek, dashboard.previousWeek)}
          </div>
          <div class="ntv-progress-layout">
            <div class="ntv-chart-card">
              <div class="ntv-chart-legend">
                <span><i class="dot terrain"></i>Terrain</span>
                <span><i class="dot calls"></i>Appels</span>
              </div>
              ${renderWeeklyChart(dashboard.weekly)}
            </div>
            <div class="ntv-table-card">
              <table class="ntv-table">
                <thead>
                  <tr><th>Semaine</th><th>Terrain</th><th>Appels</th><th>Total</th><th>Chauds</th><th>Ecoles</th><th>Jours actifs</th><th>Velocite</th><th>Tendance</th></tr>
                </thead>
                <tbody>
                  ${dashboard.weekly.map((week) => `
                    <tr>
                      <td>${escapeHtml(week.label)}</td>
                      <td>${num(week.terrain)}</td>
                      <td>${num(week.calls)}</td>
                      <td>${num(week.total)}</td>
                      <td>${num(week.hot)}</td>
                      <td>${num(week.schools)}</td>
                      <td>${num(week.activeDays)}</td>
                      <td>${week.velocity.toFixed(1)}</td>
                      <td class="${week.delta >= 0 ? "up" : "down"}">${week.delta >= 0 ? "+" : ""}${num(week.delta)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        ${renderRankingSection(user, dashboard)}

        <section class="ntv-section" id="dash-equipe">
          <div class="ntv-section-head">
            <div>
              <span class="ntv-kicker">Area + Zone Layers</span>
              <h3>Organisation par ville et corridor</h3>
            </div>
          </div>
          <div class="ntv-city-grid">
            ${dashboard.layers.cities.length ? dashboard.layers.cities.map((city) => `
              <article class="ntv-layer-card">
                <span class="ntv-kicker">${escapeHtml(city.city)}</span>
                <strong>${num(city.count)} ecoles</strong>
                <p>${percent(city.hotRate)} hot rate | ${num(city.won)} gagnes</p>
                <small>Zone dominante: ${escapeHtml(city.topZone)}</small>
              </article>
            `).join("") : renderEmpty("Aucune couche ville pour ce filtre.")}
          </div>
          <div class="ntv-zone-grid">
            ${dashboard.layers.zones.length ? dashboard.layers.zones.slice(0, 10).map((zone) => `
              <article class="ntv-zone-card">
                <div>
                  <span class="ntv-kicker">${escapeHtml(zone.city)}</span>
                  <strong>${escapeHtml(zone.zone)}</strong>
                </div>
                <div class="ntv-zone-meta">
                  <span>${num(zone.count)} ecoles</span>
                  <span>${percent(zone.hotRate)} hot</span>
                  <span>${num(zone.expertCount)} experts</span>
                </div>
              </article>
            `).join("") : ""}
          </div>
        </section>

        ${renderMetricsSection(dashboard)}

        <section class="ntv-section">
          <div class="ntv-section-head">
            <div>
              <span class="ntv-kicker">Ecoles par etape</span>
              <h3>Pipeline detaille avec contacts et appels</h3>
            </div>
          </div>
          <div class="ntv-stage-columns">
            ${dashboard.stageGroups.map((group) => `
              <article class="ntv-stage-column ${group.color}">
                <header>
                  <span>${escapeHtml(group.label)}</span>
                  <strong>${num(group.schools.length)}</strong>
                </header>
                <div class="ntv-stage-list">
                  ${group.schools.length ? group.schools.map((record) => renderSchoolCard(record, dashboard.scope === "combined")).join("") : renderEmpty("Aucune ecole dans cette etape.")}
                </div>
              </article>
            `).join("")}
          </div>
        </section>

        ${renderCallsSection(user, dashboard)}

        <section class="ntv-section">
          <div class="ntv-section-head">
            <div>
              <span class="ntv-kicker">Deals gagnes</span>
              <h3>Montants et ecoles converties</h3>
            </div>
          </div>
          <div class="ntv-win-grid">
            ${dashboard.wonDeals.length ? dashboard.wonDeals.map((record) => `
              <article class="ntv-win-card">
                <span class="ntv-kicker">${escapeHtml(record.city || "Sans ville")} | ${escapeHtml(record.zone || "Sans zone")}</span>
                <strong>${escapeHtml(record.schoolName)}</strong>
                <p>${money(record.dealValue)}</p>
                <small>${escapeHtml(record.contactName || "Contact a confirmer")}</small>
              </article>
            `).join("") : renderEmpty("Aucun deal marque comme gagne dans cette vue.")}
          </div>
        </section>

        ${dashboard.scope === "combined" ? `
          <section class="ntv-section">
            <div class="ntv-section-head">
              <div>
                <span class="ntv-kicker">Progression par agent</span>
                <h3>Mini courbe 4 semaines, terrain, appels et tendance</h3>
              </div>
            </div>
            <div class="ntv-agent-grid">
              ${dashboard.agentProgress.map((agent) => `
                <article class="ntv-agent-card">
                  <div class="ntv-agent-head">
                    <div>
                      <span class="ntv-kicker">Agent</span>
                      <strong>${escapeHtml(agent.expert)}</strong>
                    </div>
                    <span class="ntv-trend ${agent.trend >= 0 ? "up" : "down"}">${agent.trend >= 0 ? "📈" : "📉"} ${agent.trend >= 0 ? "+" : ""}${num(agent.trend)}</span>
                  </div>
                  ${renderMiniChart(agent.series)}
                  <div class="ntv-agent-meta">
                    <span>Semaine: ${num(agent.current.total)}</span>
                    <span>Terrain: ${num(agent.current.terrain)}</span>
                    <span>Appels: ${num(agent.current.calls)}</span>
                    <span>Velocite: ${agent.velocity.velocity.toFixed(1)}</span>
                  </div>
                </article>
              `).join("")}
            </div>
          </section>
        ` : ""}

        <section class="ntv-section" id="dash-nlp">
          <div class="ntv-section-head">
            <div>
              <span class="ntv-kicker">Insights</span>
              <h3>Concurrents, objections, playbook et argumentaires</h3>
            </div>
          </div>
          ${dashboard.coach ? `
            <article class="ntv-coach-card">
              <span class="ntv-kicker">Coaching expert</span>
              <strong>${escapeHtml(dashboard.coach.expert)}</strong>
              <p>${escapeHtml(dashboard.coach.tip)}</p>
              <small>${escapeHtml(dashboard.coach.action)}</small>
            </article>
          ` : ""}
          <div class="ntv-insight-grid">
            ${(dashboard.competitors || []).slice(0, 6).map((competitor) => renderCompetitorCard(competitor)).join("")}
          </div>
          <details class="ntv-details">
            <summary>Bibliotheque complete des concurrents</summary>
            <div class="ntv-insight-grid">
              ${COMPETITOR_DATA.map((competitor) => renderCompetitorCard(competitor)).join("")}
            </div>
          </details>
          <div class="ntv-insight-grid two">
            ${(TIPS_DATA.objections || []).map((item) => `
              <article class="ntv-insight-card">
                <span class="ntv-kicker">Objection</span>
                <strong>${escapeHtml(item.obj)}</strong>
                <p>${escapeHtml(item.right)}</p>
                <small>${escapeHtml(item.tactic)}</small>
              </article>
            `).join("")}
          </div>
          <div class="ntv-insight-grid two">
            ${(TIPS_DATA.closing_strategies || []).map((item) => `
              <article class="ntv-insight-card">
                <span class="ntv-kicker">${escapeHtml(item.when)}</span>
                <strong>${escapeHtml(item.name)}</strong>
                <p>${item.steps.map((step) => escapeHtml(step)).join("<br>")}</p>
                <small>${escapeHtml(item.expected_lift)}</small>
              </article>
            `).join("")}
          </div>
          <div class="ntv-insight-grid two">
            ${(TIPS_DATA.pitch_by_segment || []).map((item) => `
              <article class="ntv-insight-card">
                <span class="ntv-kicker">${escapeHtml(item.segment)}</span>
                <strong>${escapeHtml(item.price)}</strong>
                <p>${escapeHtml(item.pitch)}</p>
                <small>${escapeHtml(item.competitor)}</small>
              </article>
            `).join("")}
          </div>
          <article class="ntv-advantage-card">
            <span class="ntv-kicker">${escapeHtml(TIPS_DATA.nateiva_advantages?.tagline || "Build | Learn | Earn")}</span>
            <h4>${escapeHtml(TIPS_DATA.nateiva_advantages?.title || "NATEIVA")}</h4>
            <div class="ntv-advantage-list">
              ${(TIPS_DATA.nateiva_advantages?.real_unique_differentiators || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
            </div>
          </article>
        </section>

        ${renderStrategySection(dashboard)}

        ${renderUsersSection(user, dashboard)}
      </main>
    `;
  }

  function renderRankingSection(user, dashboard) {
    const personalRank = dashboard.rankings.find((item) => sameName(item.expert, user.fullName));
    const rows = dashboard.scope === "combined"
      ? dashboard.rankings
      : dashboard.rankings.filter((item) => sameName(item.expert, user.fullName));
    return `
      <section class="ntv-section" id="dash-rang">
        <div class="ntv-section-head">
          <div>
            <span class="ntv-kicker">Rang</span>
            <h3>Classement et performance</h3>
            <p>${dashboard.scope === "combined" ? "Vue equipe complete du score de prospection." : "Votre rang reste visible, mais les donnees des autres experts restent masquees."}</p>
          </div>
        </div>
        ${personalRank ? `
          <div class="ntv-rank-hero">
            <article class="ntv-rank-highlight">
              <span class="ntv-kicker">Mon rang</span>
              <strong>#${num(personalRank.rank)}</strong>
              <p>${escapeHtml(personalRank.expert)} · ${num(personalRank.score)} pts</p>
            </article>
          </div>
        ` : ""}
        <div class="ntv-rank-grid">
          ${rows.map((item) => `
            <article class="ntv-rank-card ${sameName(item.expert, user.fullName) ? "me" : ""}">
              <div class="ntv-rank-head">
                <span>#${num(item.rank)}</span>
                <strong>${escapeHtml(item.expert)}</strong>
              </div>
              <div class="ntv-rank-meta">
                <span>${num(item.schools)} ecoles</span>
                <span>${num(item.hot)} chauds</span>
                <span>${num(item.won)} gagnes</span>
                <span>${num(item.calls)} appels</span>
                <span>${item.velocity.toFixed(1)}/jour</span>
              </div>
              <small>${num(item.score)} points | ${num(item.activeDays)} jours actifs</small>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderCallsSection(user, dashboard) {
    const callSchools = dashboard.filteredRecords
      .filter((record) => record.callCount > 0 || record.phone)
      .sort((a, b) => (b.callCount - a.callCount) || ((Number(b.rate) || 0) - (Number(a.rate) || 0)));
    const recentCalls = dashboard.filteredFollowups
      .filter((item) => item.FollowupType === "CALL")
      .sort((a, b) => (toDate(b.Timestamp) || 0) - (toDate(a.Timestamp) || 0))
      .slice(0, 10);
    return `
      <section class="ntv-section" id="dash-appels">
        <div class="ntv-section-head">
          <div>
            <span class="ntv-kicker">Appels</span>
            <h3>Liste des appels et rappels rapides</h3>
            <p>Vue orientee action pour appeler, rappeler et suivre les ecoles les plus actives.</p>
          </div>
        </div>
        <div class="ntv-calls-grid">
          <section class="ntv-card">
            <div class="ntv-card-top">
              <span class="ntv-kicker">Top ecoles a appeler</span>
              <h4>Contacts + nombre d'appels</h4>
            </div>
            <div class="ntv-stage-list">
              ${callSchools.length ? callSchools.slice(0, 20).map((record) => renderSchoolCard(record, dashboard.scope === "combined")).join("") : renderEmpty("Aucune ecole appelable dans ce filtre.")}
            </div>
          </section>
          <section class="ntv-card">
            <div class="ntv-card-top">
              <span class="ntv-kicker">Journal appels</span>
              <h4>Derniers appels enregistres</h4>
            </div>
            <div class="ntv-history-list">
              ${recentCalls.length ? recentCalls.map((item) => `
                <article class="ntv-history-card">
                  <div class="ntv-history-head">
                    <strong>${escapeHtml(item.SchoolName)}</strong>
                    <span class="ntv-tag">CALL</span>
                  </div>
                  <p>${escapeHtml(item.ContactName || "Contact a preciser")} | ${escapeHtml(item.Outcome || item.Status || "En cours")}</p>
                  <small>${dateTime(item.Timestamp)}</small>
                </article>
              `).join("") : renderEmpty("Aucun appel enregistre dans cette vue.")}
            </div>
          </section>
        </div>
      </section>
    `;
  }

  function renderMetricsSection(dashboard) {
    const rows = dashboard.scope === "combined"
      ? dashboard.expertVelocity
      : dashboard.expertVelocity.filter((item) => sameName(item.expert, state.currentUser?.fullName));
    return `
      <section class="ntv-section">
        <div class="ntv-section-head">
          <div>
            <span class="ntv-kicker">Business Intelligence</span>
            <h3>Sources, métriques et vélocité</h3>
            <p>La vélocité est calculée sur les jours actifs distincts où au moins une saisie a été faite dans le système.</p>
          </div>
        </div>
        <div class="ntv-users-grid">
          <article class="ntv-user-card">
            <span class="ntv-kicker">Source terrain</span>
            <strong>${num(dashboard.sourceStats.terrainInputs)} prospections</strong>
            <p>${num(dashboard.sourceStats.terrainInputs)} lignes terrain chargées depuis la feuille de prospection.</p>
            <a class="ntv-link-pill" href="${attr(dashboard.sourceStats.sourceLinks.prospectionSheet)}" target="_blank" rel="noreferrer">Ouvrir la feuille terrain ↗</a>
          </article>
          <article class="ntv-user-card">
            <span class="ntv-kicker">Source appels</span>
            <strong>${num(dashboard.sourceStats.callInputs)} appels</strong>
            <p>${num(dashboard.sourceStats.callInputs)} appels reliés au pipeline, aux experts et aux semaines.</p>
            <a class="ntv-link-pill" href="${attr(dashboard.sourceStats.sourceLinks.callsSheet)}" target="_blank" rel="noreferrer">Ouvrir la feuille appels ↗</a>
          </article>
          <article class="ntv-user-card">
            <span class="ntv-kicker">Velocite globale</span>
            <strong>${dashboard.velocity.velocity.toFixed(1)} / jour</strong>
            <p>${num(dashboard.velocity.totalInputs)} inputs sur ${num(dashboard.velocity.activeDays)} jours actifs distincts.</p>
            <div class="ntv-inline-metrics">
              <span>Terrain ${dashboard.velocity.terrainVelocity.toFixed(1)}</span>
              <span>Appels ${dashboard.velocity.callVelocity.toFixed(1)}</span>
            </div>
          </article>
        </div>
        <div class="ntv-card ntv-table-card">
          <div class="ntv-card-top">
            <span class="ntv-kicker">Velocity Matrix</span>
            <h4>Analyse par expert</h4>
          </div>
          <table class="ntv-table">
            <thead>
              <tr><th>Expert</th><th>Inputs</th><th>Jours actifs</th><th>Velocite</th><th>Terrain</th><th>Appels</th><th>Ecoles</th><th>Derniere saisie</th></tr>
            </thead>
            <tbody>
              ${rows.map((item) => `
                <tr>
                  <td><strong>${escapeHtml(item.expert)}</strong></td>
                  <td>${num(item.totalInputs)}</td>
                  <td>${num(item.activeDays)}</td>
                  <td>${item.velocity.toFixed(1)}</td>
                  <td>${num(item.terrainInputs)}</td>
                  <td>${num(item.callInputs)}</td>
                  <td>${num(item.schools)}</td>
                  <td>${dateTime(item.lastInput)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderStrategySection(dashboard) {
    return `
      <section class="ntv-section">
        <div class="ntv-section-head">
          <div>
            <span class="ntv-kicker">Playbook + Glossaire</span>
            <h3>Règles d’exécution et définitions utiles</h3>
            <p>On garde les briques historiques du produit: playbook commercial, glossaire, analyse NLP et business intelligence.</p>
          </div>
        </div>
        <div class="ntv-rank-grid">
          ${dashboard.playbookRules.map((rule) => `
            <article class="ntv-rank-card">
              <div class="ntv-rank-head">
                <span>🎯</span>
                <strong>${escapeHtml(rule.title)}</strong>
              </div>
              <small>${escapeHtml(rule.copy)}</small>
            </article>
          `).join("")}
        </div>
        <div class="ntv-rank-grid">
          ${dashboard.glossary.map((item) => `
            <article class="ntv-rank-card">
              <div class="ntv-rank-head">
                <span>📘</span>
                <strong>${escapeHtml(item.title)}</strong>
              </div>
              <p>${escapeHtml(item.description)}</p>
              <small>${escapeHtml(item.use)}</small>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderUsersSection(user, dashboard) {
    const allowed = ["Noah", "Ntsa Guy", "Mbeuka brice"];
    return `
      <section class="ntv-section" id="dash-users">
        <div class="ntv-section-head">
          <div>
            <span class="ntv-kicker">Users</span>
            <h3>Compte, droits d'acces et raccourcis</h3>
            <p>Retrouver rapidement votre espace de saisie et rappeler qui peut ouvrir la vue combinee.</p>
          </div>
        </div>
        <div class="ntv-users-grid">
          <article class="ntv-user-card">
            <span class="ntv-kicker">Compte connecte</span>
            <strong>${escapeHtml(user.fullName)}</strong>
            <p>${escapeHtml(canSeeCombined(user) ? "Acces combine autorise" : "Acces expert personnel uniquement")} | Ville ${escapeHtml(user.city || "ALL")}</p>
            <div class="ntv-user-shortcuts">
              <button class="ntv-primary" data-action="open-workspace" data-tab="new-entry">📝 New Entry</button>
              <button class="ntv-secondary" data-action="open-workspace" data-tab="follow-up">📞 Follow Up</button>
            </div>
          </article>
          <article class="ntv-user-card">
            <span class="ntv-kicker">Vue combinee</span>
            <strong>${num(dashboard.filteredRecords.length)}</strong>
            <p>Accessible seulement par les comptes autorises ci-dessous.</p>
            <div class="ntv-allowed-list">
              ${allowed.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}
            </div>
          </article>
        </div>
      </section>
    `;
  }

  function renderWorkspace(user) {
    const personalRaw = getScopedRaw(user, "personal");
    const personalFollowups = getScopedFollowups(user, "personal");
    const personalRecords = buildSchoolRecords(personalRaw, personalFollowups);
    const recentEntries = personalRaw
      .slice()
      .sort((a, b) => (toDate(b.t) || 0) - (toDate(a.t) || 0))
      .slice(0, 8);
    const recentFollowups = personalFollowups
      .slice()
      .sort((a, b) => (toDate(b.Timestamp) || 0) - (toDate(a.Timestamp) || 0))
      .slice(0, 10);
    const thisWeekEntries = personalRaw.filter((row) => weekKey(new Date()) === weekKey(toDate(row.t) || new Date())).length;
    const hotDeals = personalRecords.filter((record) => record.stage === "chaud" || record.stage === "gagne").length;

    return `
      <main class="ntv-main">
        <section class="ntv-section">
          <div class="ntv-section-head">
            <div>
              <span class="ntv-kicker">Votre compte</span>
              <h3>New Entry et Follow Up</h3>
              <p>Chaque action alimente directement votre pipeline personnel, tandis que le dashboard utilise les memes donnees.</p>
            </div>
            <div class="ntv-tab-strip">
              <button class="ntv-top-pill ${state.workspaceTab === "new-entry" ? "active" : ""}" data-action="workspace-tab" data-tab="new-entry">New Entry</button>
              <button class="ntv-top-pill ${state.workspaceTab === "follow-up" ? "active" : ""}" data-action="workspace-tab" data-tab="follow-up">Follow Up</button>
            </div>
          </div>
          <div class="ntv-metric-grid">
            <article class="ntv-metric-card accent"><span class="ntv-kicker">Mon portefeuille</span><strong>${num(personalRecords.length)}</strong><p>Ecoles rattachees a votre compte.</p></article>
            <article class="ntv-metric-card"><span class="ntv-kicker">Cette semaine</span><strong>${num(thisWeekEntries)}</strong><p>Nouvelles entrees terrain.</p></article>
            <article class="ntv-metric-card"><span class="ntv-kicker">Deals actifs</span><strong>${num(hotDeals)}</strong><p>Chauds + gagnes visibles.</p></article>
            <article class="ntv-metric-card"><span class="ntv-kicker">Follow-ups</span><strong>${num(personalFollowups.length)}</strong><p>Appels, WhatsApp, SMS et visites.</p></article>
          </div>
        </section>
        ${state.workspaceTab === "new-entry"
          ? renderNewEntryPanel(user, recentEntries)
          : renderFollowupPanel(user, personalRecords, recentFollowups)}
      </main>
    `;
  }

  function renderNewEntryPanel(user, recentEntries) {
    return `
      <section class="ntv-work-grid">
        <form class="ntv-card ntv-form-card" id="ntv-new-entry-form">
          <div class="ntv-card-top">
            <span class="ntv-kicker">New Entry</span>
            <h4>Ajouter une nouvelle ecole</h4>
          </div>
          <div class="ntv-form-grid">
            ${fieldText("Nom de l'ecole", "schoolName", "Ex: College Horizon", true)}
            ${fieldSelect("Type", "schoolType", ["Primaire", "Secondaire", "Technique", "Universite"], false)}
            ${fieldText("Contact", "contactName", "Nom de la personne")}
            ${fieldText("Role", "contactRole", "Directeur, Fondateur...")}
            ${fieldText("Telephone 1", "phonePrimary", "675 000 000")}
            ${fieldText("Telephone 2", "phoneSecondary", "Optionnel")}
            ${fieldSelect("Ville", "city", ["DOUALA", "YAOUNDE"], false, user.city && user.city !== "ALL" ? user.city : "DOUALA")}
            ${fieldText("Zone / Secteur", "zone", "BONABERIE, MIMBOMAN...")}
            ${fieldSelect("Standing", "standing", ["TRES HAUTE STANDING", "HAUTE STANDING", "STANDIG MOYEN", "BASSE STANDING", "TRES BASSE STANDING"], false)}
            ${fieldText("Effectif", "effectif", "Ex: 450", false, "number")}
            ${fieldText("Taux estime", "rate", "0 - 100", false, "number")}
            ${fieldText("Localisation", "location", "Landmark / rue")}
            ${fieldTextarea("Commentaire terrain", "comment", "Ce qui s'est passe a la visite...")}
            ${fieldTextarea("Remarque", "remark", "Blocage, promesse, suite...")}
          </div>
          <button class="ntv-primary" type="submit">Enregistrer l'entree</button>
        </form>
        <section class="ntv-card">
          <div class="ntv-card-top">
            <span class="ntv-kicker">Recent entries</span>
            <h4>Vos derniers ajouts</h4>
          </div>
          <div class="ntv-history-list">
            ${recentEntries.length ? recentEntries.map((row) => `
              <article class="ntv-history-card">
                <div class="ntv-history-head">
                  <strong>${escapeHtml(row.n)}</strong>
                  ${pctBadge(row.r)}
                </div>
                <p>${escapeHtml(row.v || "--")} | ${escapeHtml(zoneOf(row) || "--")} | ${escapeHtml(row.rn || "Contact a preciser")}</p>
                <small>${dateTime(row.t)}</small>
              </article>
            `).join("") : renderEmpty("Aucune nouvelle entree encore.")}
          </div>
        </section>
      </section>
    `;
  }

  function renderFollowupPanel(user, personalRecords, recentFollowups) {
    const schoolOptions = personalRecords.map((record) => record.schoolName).sort((a, b) => a.localeCompare(b));
    return `
      <section class="ntv-work-grid">
        <form class="ntv-card ntv-form-card" id="ntv-followup-form">
          <div class="ntv-card-top">
            <span class="ntv-kicker">Follow Up</span>
            <h4>Ajouter un appel, WhatsApp ou visite</h4>
          </div>
          <div class="ntv-form-grid">
            <label class="ntv-field full">
              <span>Ecole</span>
              <select id="followupSchool" name="schoolName">
                <option value="">-- Selectionner --</option>
                ${schoolOptions.map((name) => `<option value="${attr(name)}" ${state.pendingFollowupSchool === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
              </select>
            </label>
            ${fieldText("Contact", "contactName", "Nom du contact")}
            ${fieldText("Telephone", "contactPhone", "675 000 000")}
            ${fieldSelect("Type", "followupType", ["CALL", "WHATSAPP", "SMS", "VISIT"], false, "CALL")}
            ${fieldSelect("Resultat", "outcome", ["", "Interesse", "Pas interesse", "Rappeler plus tard", "Dossier transmis", "RDV fixe", "Demo faite", "Converti"], false)}
            ${fieldSelect("Statut", "status", ["En cours", "Relance", "Converti", "Termine"], false, "En cours")}
            ${fieldSelect("Ville", "city", ["DOUALA", "YAOUNDE"], false, user.city && user.city !== "ALL" ? user.city : "DOUALA")}
            ${fieldText("Zone / Secteur", "zone", "BONABERIE, TSINGA...")}
            ${fieldText("Prochaine action", "nextAction", "Rappeler lundi...")}
            ${fieldText("Date prochaine action", "nextDate", "", false, "date")}
            ${fieldText("Cout terrain (si visite)", "cost", "0", false, "number")}
            ${fieldTextarea("Notes", "notes", "Resume du follow-up")}
          </div>
          <button class="ntv-primary" type="submit">Enregistrer le follow-up</button>
        </form>
        <section class="ntv-card">
          <div class="ntv-card-top">
            <span class="ntv-kicker">Historique</span>
            <h4>Derniers suivis de votre compte</h4>
          </div>
          <div class="ntv-history-list">
            ${recentFollowups.length ? recentFollowups.map((item) => `
              <article class="ntv-history-card">
                <div class="ntv-history-head">
                  <strong>${escapeHtml(item.SchoolName)}</strong>
                  <span class="ntv-tag">${escapeHtml(item.FollowupType)}</span>
                </div>
                <p>${escapeHtml(item.Outcome || item.Status || "Sans resultat")} | ${escapeHtml(item.ContactName || "Contact a preciser")}</p>
                <small>${dateTime(item.Timestamp)}</small>
              </article>
            `).join("") : renderEmpty("Aucun follow-up pour le moment.")}
          </div>
          <div class="ntv-shortlist">
            <h5>Ecoles chaudes a relancer</h5>
            ${personalRecords.filter((record) => record.stage === "chaud" || record.stage === "tiede").slice(0, 8).map((record) => `
              <button class="ntv-short-item" type="button" data-action="prefill-followup" data-school="${attr(record.schoolName)}">
                <span>${escapeHtml(record.schoolName)}</span>
                ${pctBadge(record.rate)}
              </button>
            `).join("")}
          </div>
        </section>
      </section>
    `;
  }

  function renderScopeSwitch(user, scope) {
    if (!canSeeCombined(user)) {
      return `<div class="ntv-lock-inline">Vue combinee reservee a Noah, Guy et Mbeuka.</div>`;
    }
    return `
      <div class="ntv-scope-switch">
        <button class="ntv-top-pill ${scope === "personal" ? "active" : ""}" data-action="scope" data-scope="personal">Mon compte</button>
        <button class="ntv-top-pill ${scope === "combined" ? "active" : ""}" data-action="scope" data-scope="combined">Equipe combinee</button>
      </div>
    `;
  }

  function renderStageMetric(stage) {
    return `
      <article class="ntv-stage-metric ${stage.color}">
        <div class="ntv-stage-head">
          <span>${escapeHtml(stage.label)}</span>
          <strong>${num(stage.count)}</strong>
        </div>
        <div class="ntv-bar-track"><span style="width:${Math.min(stage.percent, 100)}%"></span></div>
        <div class="ntv-stage-foot">
          <small>${percent(stage.percent)}</small>
          <small>${money(stage.amount)}</small>
        </div>
      </article>
    `;
  }

  function renderRevenueCard(title, value, copy) {
    return `
      <article class="ntv-revenue-card">
        <span class="ntv-kicker">${escapeHtml(title)}</span>
        <strong>${money(value)}</strong>
        <p>${escapeHtml(copy)}</p>
      </article>
    `;
  }

  function renderWeeklyChart(series) {
    const max = Math.max(...series.map((item) => item.total), 1);
    return `
      <div class="ntv-week-chart">
        ${series.map((week) => {
          const terrainHeight = Math.round((week.terrain / max) * 100);
          const callsHeight = Math.round((week.calls / max) * 100);
          return `
            <div class="ntv-week-column">
              <span class="ntv-week-delta ${week.delta >= 0 ? "up" : "down"}">${week.delta >= 0 ? "+" : ""}${num(week.delta)}</span>
              <div class="ntv-week-bar">
                <i class="terrain" style="height:${terrainHeight}%"></i>
                <i class="calls" style="height:${callsHeight}%;bottom:${terrainHeight}%"></i>
              </div>
              <div class="ntv-week-meta">
                <strong>${num(week.total)}</strong>
                <span>${escapeHtml(week.label)}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderCompareCard(current, previous) {
    const growth = current.total - previous.total;
    return `
      <article class="ntv-compare-card ${growth >= 0 ? "up" : "down"}">
        <span>${growth >= 0 ? "📈 croissance" : "📉 baisse"}</span>
        <strong>${growth >= 0 ? "+" : ""}${num(growth)}</strong>
        <small>Total ${num(current.total)} | Terrain ${num(current.terrain)} | Appels ${num(current.calls)} | ${current.velocity.toFixed(1)}/jour | ${num(current.activeDays)} jours actifs</small>
      </article>
    `;
  }

  function renderSchoolCard(record, showExpert) {
    const phone = phoneHref(record.phone);
    return `
      <article class="ntv-school-card">
        <div class="ntv-school-head">
          <strong>${escapeHtml(record.schoolName)}</strong>
          ${pctBadge(record.rate)}
        </div>
        <p>${escapeHtml(record.city || "--")} | ${escapeHtml(record.zone || "--")} | ${escapeHtml(record.standing || "Sans segment")}</p>
        <div class="ntv-school-meta">
          <span>Contact: <b>${escapeHtml(record.contactName || "A confirmer")}</b></span>
          <span>Appels: <b>${num(record.callCount)}</b></span>
          <span>Suivis: <b>${num(record.followupCount)}</b></span>
          ${showExpert ? `<span>Expert: <b>${escapeHtml(record.expert || "--")}</b></span>` : ""}
        </div>
        <div class="ntv-school-actions">
          ${phone ? `<a class="ntv-call" href="${attr(phone)}">📞 Appeler</a>` : `<span class="ntv-call disabled">📞 Pas de numero</span>`}
          <button class="ntv-chip-btn" type="button" data-action="prefill-followup" data-school="${attr(record.schoolName)}">Suivre</button>
        </div>
      </article>
    `;
  }

  function renderMiniChart(series) {
    const max = Math.max(...series.map((item) => item.total), 1);
    return `
      <div class="ntv-mini-chart">
        ${series.map((week) => `
          <span class="mini-bar" style="height:${Math.max(10, Math.round((week.total / max) * 100))}%"></span>
        `).join("")}
      </div>
    `;
  }

  function renderCompetitorCard(competitor) {
    return `
      <article class="ntv-insight-card">
        <span class="ntv-kicker">${escapeHtml(competitor.flag || "")} ${escapeHtml(competitor.tier || "")}</span>
        <strong>${escapeHtml(competitor.name)}</strong>
        <p>${escapeHtml(competitor.insight || competitor.force || "")}</p>
        <small>${escapeHtml(competitor.battlecard || competitor.weakness || "")}</small>
      </article>
    `;
  }

  function renderOptions(values, selected, emptyLabel) {
    return values.map((value, index) => {
      const label = value || emptyLabel;
      const isSelected = value === selected || (!value && index === 0 && !selected);
      return `<option value="${attr(value)}" ${isSelected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
  }

  function renderStageOptions(selected) {
    const values = ["", ...STAGES.map((stage) => stage.key)];
    return values.map((value, index) => {
      const stage = STAGES.find((item) => item.key === value);
      const label = value ? stage.label : "Toutes les etapes";
      const isSelected = value === selected || (!value && index === 0 && !selected);
      return `<option value="${attr(value)}" ${isSelected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
  }

  function renderEmpty(text) {
    return `<div class="ntv-empty">${escapeHtml(text)}</div>`;
  }

  function fieldText(label, name, placeholder, required = false, type = "text") {
    return `
      <label class="ntv-field">
        <span>${escapeHtml(label)}</span>
        <input type="${type}" name="${attr(name)}" placeholder="${attr(placeholder || "")}" ${required ? "required" : ""}>
      </label>
    `;
  }

  function fieldTextarea(label, name, placeholder) {
    return `
      <label class="ntv-field full">
        <span>${escapeHtml(label)}</span>
        <textarea name="${attr(name)}" placeholder="${attr(placeholder || "")}"></textarea>
      </label>
    `;
  }

  function fieldSelect(label, name, options, required = false, selected = "") {
    return `
      <label class="ntv-field">
        <span>${escapeHtml(label)}</span>
        <select name="${attr(name)}" ${required ? "required" : ""}>
          ${options.map((value) => `<option value="${attr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :root{
        --ntv-red:#d3272c;
        --ntv-red-deep:#8d171c;
        --ntv-cream:#fff1ec;
        --ntv-paper:#fffdfb;
        --ntv-ink:#141414;
        --ntv-muted:#6f6a64;
        --ntv-line:rgba(20,20,20,.08);
        --ntv-teal:#0f8b8d;
        --ntv-amber:#e7a51c;
        --ntv-green:#0f9d58;
        --ntv-slate:#4f5865;
        --ntv-radius:28px;
        --ntv-shadow:0 24px 60px rgba(20,20,20,.08);
      }
      *{box-sizing:border-box}
      body.ntv-body{
        margin:0;
        min-height:100vh;
        background:
          radial-gradient(circle at top right, rgba(211,39,44,.24), transparent 28%),
          radial-gradient(circle at top left, rgba(231,165,28,.18), transparent 24%),
          radial-gradient(circle at bottom left, rgba(15,139,141,.16), transparent 26%),
          linear-gradient(180deg, #fff7f4 0%, #fff0eb 100%);
        color:var(--ntv-ink);
        font-family:'DM Sans',sans-serif;
      }
      #${ROOT_ID}{padding:28px}
      .ntv-shell{max-width:1480px;margin:0 auto;display:flex;flex-direction:column;gap:22px}
      .ntv-topbar,.ntv-launch,.ntv-section,.ntv-card,.ntv-login-card,.ntv-brand-panel{background:linear-gradient(180deg,rgba(255,255,255,.95),rgba(255,246,241,.9));backdrop-filter:blur(18px);border:1px solid var(--ntv-line);box-shadow:var(--ntv-shadow)}
      .ntv-topbar{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:20px 24px;border-radius:34px}
      .ntv-brand{display:flex;align-items:center;gap:16px}
      .ntv-brand-mark{width:58px;height:58px;border-radius:18px;background:linear-gradient(135deg,var(--ntv-red),#ff6b57);display:grid;place-items:center;color:#fff;font-weight:800;font-size:24px;box-shadow:0 18px 35px rgba(211,39,44,.25)}
      .ntv-brand h2,.ntv-card-top h2,.ntv-card-top h4,.ntv-section-head h3,.ntv-brand-panel h1{font-family:'Fraunces',serif;letter-spacing:-.04em;margin:0}
      .ntv-brand h2{font-size:24px;line-height:1.05}
      .ntv-kicker{display:inline-flex;align-items:center;gap:8px;font:700 11px/1.1 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.12em;color:var(--ntv-red)}
      .ntv-top-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .ntv-user-box{display:flex;flex-direction:column;gap:2px;padding:10px 14px;border-radius:18px;background:rgba(20,20,20,.04)}
      .ntv-user-name{font-weight:700}
      .ntv-user-meta{font-size:12px;color:var(--ntv-muted)}
      .ntv-top-pill,.ntv-secondary,.ntv-ghost,.ntv-primary,.ntv-short-item,.ntv-chip-btn{
        border:1px solid var(--ntv-line);
        border-radius:999px;
        background:#fff;
        color:var(--ntv-ink);
        padding:12px 16px;
        font:700 13px/1 'DM Sans',sans-serif;
        cursor:pointer;
        transition:transform .18s ease, box-shadow .18s ease, background .18s ease, color .18s ease;
      }
      .ntv-top-pill.active,.ntv-primary,.ntv-launch-card.active{background:linear-gradient(135deg,var(--ntv-red-deep),var(--ntv-red));color:#fff;border-color:transparent;box-shadow:0 16px 34px rgba(211,39,44,.2)}
      .ntv-secondary{background:rgba(20,20,20,.04)}
      .ntv-ghost{background:transparent}
      .ntv-top-pill:hover,.ntv-secondary:hover,.ntv-ghost:hover,.ntv-primary:hover,.ntv-short-item:hover,.ntv-chip-btn:hover,.ntv-launch-card:hover{transform:translateY(-1px)}
      .ntv-launch{display:grid;grid-template-columns:1fr 1fr 280px;gap:16px;padding:18px;border-radius:34px}
      .ntv-launch-card{border:none;text-align:left;border-radius:28px;padding:24px;background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(255,240,234,.96))}
      .ntv-launch-card strong{display:block;font-size:28px;font-family:'Fraunces',serif;letter-spacing:-.04em;margin:8px 0 6px}
      .ntv-launch-card p,.ntv-brand-panel p,.ntv-card-top p,.ntv-section-head p,.ntv-revenue-card p,.ntv-metric-card p,.ntv-layer-card p,.ntv-school-card p,.ntv-insight-card p,.ntv-win-card p,.ntv-login-note{margin:0;color:var(--ntv-muted);line-height:1.55}
      .ntv-launch-summary{border-radius:28px;padding:22px;background:linear-gradient(135deg,rgba(15,139,141,.12),rgba(255,255,255,.96));display:grid;gap:16px}
      .ntv-launch-summary div{display:grid;gap:4px}
      .ntv-launch-summary strong{font-size:28px;font-family:'Fraunces',serif}
      .ntv-main{display:grid;gap:22px}
      .ntv-section,.ntv-card{border-radius:34px;padding:24px}
      .ntv-section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}
      .ntv-section-head h3{font-size:34px;line-height:1.02;margin:6px 0 6px}
      .ntv-filter-bar{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
      .ntv-inline-field,.ntv-field{display:flex;flex-direction:column;gap:8px}
      .ntv-inline-field span,.ntv-field span{font:700 11px/1 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ntv-muted)}
      .ntv-inline-field select,.ntv-inline-field input,.ntv-field input,.ntv-field select,.ntv-field textarea{
        min-height:48px;
        padding:14px 16px;
        border-radius:16px;
        border:1px solid var(--ntv-line);
        background:#fff;
        color:var(--ntv-ink);
        font:500 14px/1.4 'DM Sans',sans-serif;
      }
      .ntv-field textarea{min-height:116px;resize:vertical}
      .ntv-search{min-width:250px;flex:1}
      .ntv-metric-grid,.ntv-revenue-grid,.ntv-city-grid,.ntv-win-grid,.ntv-insight-grid,.ntv-agent-grid,.ntv-stage-columns,.ntv-work-grid{display:grid;gap:16px}
      .ntv-metric-grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:18px}
      .ntv-metric-card,.ntv-revenue-card,.ntv-layer-card,.ntv-zone-card,.ntv-win-card,.ntv-insight-card,.ntv-agent-card,.ntv-coach-card,.ntv-advantage-card{
        border-radius:26px;padding:20px;background:linear-gradient(180deg,#fff,#fff6f1);border:1px solid var(--ntv-line)
      }
      .ntv-metric-card strong,.ntv-revenue-card strong,.ntv-layer-card strong,.ntv-win-card strong,.ntv-brand-panel h1{font-size:38px;line-height:.95}
      .ntv-metric-card.accent{background:linear-gradient(135deg,var(--ntv-red-deep),var(--ntv-red));color:#fff}
      .ntv-metric-card.accent p,.ntv-metric-card.accent .ntv-kicker{color:rgba(255,255,255,.82)}
      .ntv-pipeline-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
      .ntv-stage-metric{border-radius:24px;padding:18px;background:#fff;border:1px solid var(--ntv-line)}
      .ntv-stage-head,.ntv-history-head,.ntv-school-head,.ntv-agent-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
      .ntv-stage-head strong,.ntv-history-head strong,.ntv-school-head strong,.ntv-agent-head strong{font-size:22px;line-height:1.08}
      .ntv-bar-track{height:12px;border-radius:999px;background:rgba(20,20,20,.08);overflow:hidden;margin:16px 0 12px}
      .ntv-bar-track span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--ntv-red),#ff9275)}
      .ntv-stage-foot,.ntv-zone-meta,.ntv-school-meta,.ntv-agent-meta{display:flex;flex-wrap:wrap;gap:10px;font-size:13px;color:var(--ntv-muted)}
      .ntv-legacy-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-top:18px}
      .ntv-legacy-tab{display:grid;gap:6px;justify-items:center;padding:16px 12px;border:none;border-radius:22px;background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(255,237,231,.98));box-shadow:0 14px 24px rgba(211,39,44,.08);cursor:pointer}
      .ntv-legacy-tab span{font-size:22px}
      .ntv-legacy-tab strong{font-size:13px}
      .ntv-legacy-tab.locked{opacity:.82}
      .ntv-revenue-grid{grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:16px}
      .ntv-progress-layout{display:grid;grid-template-columns:1.3fr 1fr;gap:16px}
      .ntv-chart-card,.ntv-table-card{border:1px solid var(--ntv-line);border-radius:26px;padding:18px;background:#fff}
      .ntv-chart-legend{display:flex;gap:18px;font-size:13px;color:var(--ntv-muted);margin-bottom:18px}
      .dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:7px}
      .dot.terrain{background:var(--ntv-red)}
      .dot.calls{background:var(--ntv-teal)}
      .ntv-week-chart{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:12px;align-items:end;height:320px}
      .ntv-week-column{display:grid;gap:10px;align-items:end}
      .ntv-week-bar{position:relative;height:220px;border-radius:20px;background:linear-gradient(180deg,#faf7f2,#f0ebe4);overflow:hidden;border:1px solid rgba(20,20,20,.04)}
      .ntv-week-bar i{position:absolute;left:0;right:0;display:block}
      .ntv-week-bar i.terrain{background:linear-gradient(180deg,#f26f63,var(--ntv-red));bottom:0}
      .ntv-week-bar i.calls{background:linear-gradient(180deg,#3bc7c9,var(--ntv-teal))}
      .ntv-week-delta{font:700 12px/1 'JetBrains Mono',monospace;text-align:center}
      .ntv-week-meta{display:grid;gap:4px;text-align:center}
      .ntv-week-meta strong{font-size:16px}
      .ntv-table{width:100%;border-collapse:collapse;font-size:13px}
      .ntv-table th,.ntv-table td{padding:12px;border-bottom:1px solid var(--ntv-line);text-align:left}
      .ntv-table th{font:700 11px/1 'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--ntv-muted)}
      .up{color:var(--ntv-green)}
      .down{color:var(--ntv-red)}
      .ntv-compare-card{display:grid;gap:4px;min-width:250px;padding:18px 20px;border-radius:22px;border:1px solid var(--ntv-line);background:#fff}
      .ntv-compare-card.up{background:rgba(15,157,88,.08)}
      .ntv-compare-card.down{background:rgba(211,39,44,.08)}
      .ntv-city-grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
      .ntv-zone-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:14px}
      .ntv-zone-card strong{font-size:22px}
      .ntv-stage-columns{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
      .ntv-stage-column{border:1px solid var(--ntv-line);border-radius:28px;padding:18px;background:#fff}
      .ntv-stage-column header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
      .ntv-stage-column strong{font-size:22px}
      .ntv-stage-list{display:grid;gap:12px;max-height:620px;overflow:auto;padding-right:4px}
      .ntv-school-card{border-radius:20px;padding:16px;background:#faf7f2;border:1px solid rgba(20,20,20,.06)}
      .ntv-rate{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border-radius:999px;font:700 12px/1 'JetBrains Mono',monospace}
      .ntv-rate-hot{background:rgba(211,39,44,.1);color:var(--ntv-red)}
      .ntv-rate-warm{background:rgba(231,165,28,.14);color:#996300}
      .ntv-rate-cold{background:rgba(20,20,20,.08);color:var(--ntv-slate)}
      .ntv-rate-empty{background:rgba(15,139,141,.08);color:var(--ntv-teal)}
      .ntv-school-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
      .ntv-call,.ntv-call.disabled{display:inline-flex;align-items:center;justify-content:center;padding:11px 14px;border-radius:999px;text-decoration:none;font-weight:700}
      .ntv-call{background:var(--ntv-red);color:#fff}
      .ntv-call.disabled{background:rgba(20,20,20,.06);color:var(--ntv-muted)}
      .ntv-chip-btn{padding:11px 14px}
      .ntv-win-grid,.ntv-insight-grid,.ntv-agent-grid{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
      .ntv-calls-grid,.ntv-users-grid,.ntv-rank-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
      .ntv-insight-grid.two{grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:16px}
      .ntv-insight-card strong,.ntv-win-card strong,.ntv-agent-card strong,.ntv-coach-card strong,.ntv-advantage-card h4{font-family:'Fraunces',serif;letter-spacing:-.03em;font-size:24px}
      .ntv-details{margin-top:16px;border:1px solid var(--ntv-line);border-radius:24px;padding:16px 18px;background:#fff}
      .ntv-details summary{cursor:pointer;font-weight:700}
      .ntv-coach-card{margin-bottom:16px;background:linear-gradient(135deg,rgba(211,39,44,.08),rgba(255,255,255,.95))}
      .ntv-advantage-list{display:grid;gap:10px;margin-top:14px}
      .ntv-advantage-list span{display:block;padding:12px 14px;border-radius:18px;background:#fff;border:1px solid var(--ntv-line)}
      .ntv-rank-hero{display:grid;grid-template-columns:minmax(240px,340px);margin-bottom:16px}
      .ntv-rank-highlight,.ntv-rank-card,.ntv-user-card{border-radius:24px;padding:18px;background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(255,240,232,.94));border:1px solid var(--ntv-line)}
      .ntv-rank-highlight strong{font-size:50px;font-family:'Fraunces',serif}
      .ntv-rank-card.me{background:linear-gradient(135deg,rgba(211,39,44,.12),rgba(255,255,255,.98))}
      .ntv-rank-head,.ntv-user-shortcuts{display:flex;justify-content:space-between;gap:12px;align-items:center}
      .ntv-rank-meta{display:flex;flex-wrap:wrap;gap:10px;color:var(--ntv-muted);margin:12px 0}
      .ntv-user-shortcuts{justify-content:flex-start;flex-wrap:wrap;margin-top:16px}
      .ntv-inline-metrics{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
      .ntv-inline-metrics span,.ntv-link-pill{display:inline-flex;align-items:center;justify-content:center;padding:10px 12px;border-radius:999px;background:rgba(15,139,141,.12);color:var(--ntv-teal);font-weight:700;text-decoration:none}
      .ntv-link-pill{margin-top:16px}
      .ntv-allowed-list{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
      .ntv-allowed-list span{padding:10px 12px;border-radius:999px;background:rgba(15,139,141,.12);color:var(--ntv-teal);font-weight:700}
      .ntv-agent-head{margin-bottom:14px}
      .ntv-mini-chart{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;align-items:end;height:80px}
      .mini-bar{display:block;background:linear-gradient(180deg,var(--ntv-teal),#64dfdf);border-radius:999px}
      .ntv-login{max-width:1280px;margin:0 auto;min-height:100vh;display:grid;grid-template-columns:1.2fr .8fr;gap:24px;align-items:center;padding:32px}
      .ntv-brand-panel,.ntv-login-card{padding:32px;border-radius:34px}
      .ntv-brand-panel h1{font-size:86px;line-height:.92;margin:12px 0 16px}
      .ntv-stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:28px 0}
      .ntv-stat-card{border-radius:24px;padding:18px;background:rgba(255,255,255,.75);border:1px solid var(--ntv-line);display:grid;gap:6px}
      .ntv-stat-card strong{font-family:'Fraunces',serif;font-size:34px}
      .ntv-card-top{display:grid;gap:8px;margin-bottom:18px}
      .ntv-card-top h2{font-size:44px}
      .ntv-card-top h4{font-size:30px}
      .ntv-form-error{padding:12px 14px;border-radius:16px;background:rgba(211,39,44,.08);color:var(--ntv-red);font-weight:700}
      .ntv-form-card .ntv-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:18px}
      .ntv-field.full{grid-column:1/-1}
      .ntv-work-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}
      .ntv-history-list{display:grid;gap:12px}
      .ntv-history-card{border-radius:20px;padding:16px;background:#faf7f2;border:1px solid rgba(20,20,20,.06)}
      .ntv-tag{padding:8px 10px;border-radius:999px;background:rgba(15,139,141,.1);color:var(--ntv-teal);font:700 11px/1 'JetBrains Mono',monospace}
      .ntv-shortlist{display:grid;gap:10px;margin-top:16px}
      .ntv-shortlist h5{margin:0;font-size:16px}
      .ntv-short-item{justify-content:space-between;display:flex;align-items:center;text-align:left}
      .ntv-empty{padding:16px;border-radius:18px;background:rgba(20,20,20,.04);color:var(--ntv-muted);font-size:13px}
      .ntv-scope-switch,.ntv-tab-strip{display:flex;gap:8px;flex-wrap:wrap}
      .ntv-lock-inline{padding:12px 14px;border-radius:18px;background:rgba(20,20,20,.04);font-size:13px;color:var(--ntv-muted)}
      .ntv-toast{position:fixed;right:20px;bottom:20px;z-index:1000;padding:14px 18px;border-radius:16px;background:#101010;color:#fff;opacity:0;transform:translateY(8px);pointer-events:none;transition:all .2s ease}
      .ntv-toast.show{opacity:1;transform:translateY(0)}
      .ntv-toast.error{background:var(--ntv-red)}
      @media (max-width:1120px){
        .ntv-launch,.ntv-progress-layout,.ntv-work-grid,.ntv-login{grid-template-columns:1fr}
        .ntv-topbar,.ntv-section-head{flex-direction:column;align-items:flex-start}
      }
      @media (max-width:760px){
        #${ROOT_ID}{padding:16px}
        .ntv-brand-panel h1{font-size:54px}
        .ntv-section,.ntv-card,.ntv-login-card,.ntv-brand-panel,.ntv-topbar,.ntv-launch{padding:18px}
        .ntv-card-top h2{font-size:34px}
        .ntv-section-head h3{font-size:28px}
        .ntv-form-card .ntv-form-grid,.ntv-stat-grid{grid-template-columns:1fr}
        .ntv-week-chart{grid-template-columns:repeat(4,minmax(0,1fr));height:auto}
      }
    `;
    document.head.appendChild(style);
  }
})();
