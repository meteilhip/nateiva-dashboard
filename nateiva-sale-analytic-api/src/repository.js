const { query } = require("./db");
const { defaultPermissionsForRole, normalizePermissions, buildFollowupFingerprint, buildFollowupNearDuplicateSignature, generateServerId, boolToTiny, normalizeRole } = require("./utils");

function mapUser(row) {
  if (!row) return null;
  const permissions = normalizePermissions({
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    permissions: {
      dataScope: row.data_scope,
      manageUsers: !!row.manage_users,
      panes: JSON.parse(row.panes_json || "[]")
    }
  });
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    city: row.city,
    active: !!row.active,
    permissions
  };
}

function mapFollowup(row) {
  return {
    ID: row.server_uid,
    LegacyID: row.legacy_id || "",
    Timestamp: row.event_timestamp,
    Expert: row.expert,
    SchoolName: row.school_name,
    ContactName: row.contact_name,
    ContactPhone: row.contact_phone,
    FollowupType: row.followup_type,
    Notes: row.notes,
    Outcome: row.outcome,
    NextAction: row.next_action,
    NextDate: row.next_date,
    Cost: row.cost,
    Status: row.status,
    City: row.city,
    Sector: row.sector,
    SchoolType: row.school_type,
    Category: row.category,
    Effectif: row.effectif,
    Location: row.location,
    ContactRole: row.contact_role,
    Source: row.source,
    ImportedAt: row.created_at
  };
}

async function findUserByUsername(username, includeHash) {
  const rows = await query(
    `SELECT id, username, password_hash, full_name, role, city, active, data_scope, manage_users, panes_json
     FROM users
     WHERE username = ? LIMIT 1`,
    [username]
  );
  if (!rows.length) return null;
  const row = rows[0];
  const mapped = mapUser(row);
  if (includeHash) mapped.passwordHash = row.password_hash;
  return mapped;
}

async function listUsers() {
  const rows = await query(
    `SELECT id, username, full_name, role, city, active, data_scope, manage_users, panes_json
     FROM users
     ORDER BY full_name ASC`,
    []
  );
  return rows.map(mapUser);
}

async function createUser(input) {
  const role = normalizeRole(input.role);
  const permissions = normalizePermissions({ role, permissions: input.permissions });
  await query(
    `INSERT INTO users
      (username, password_hash, full_name, role, city, active, data_scope, manage_users, panes_json)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      input.username,
      input.passwordHash,
      input.fullName,
      role,
      input.city || "DOUALA",
      permissions.dataScope,
      boolToTiny(permissions.manageUsers),
      JSON.stringify(permissions.panes)
    ]
  );
  return findUserByUsername(input.username, false);
}

async function updateUserAccess(username, patch) {
  const existing = await findUserByUsername(username, false);
  if (!existing) return null;
  const permissions = normalizePermissions({
    role: existing.role,
    permissions: {
      dataScope: patch.dataScope,
      manageUsers: patch.manageUsers,
      panes: patch.panes
    }
  });
  await query(
    `UPDATE users
     SET data_scope = ?, manage_users = ?, panes_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE username = ?`,
    [permissions.dataScope, boolToTiny(permissions.manageUsers), JSON.stringify(permissions.panes), username]
  );
  return findUserByUsername(username, false);
}

async function listVisibleFollowups(viewer) {
  const viewerCity = String(viewer && viewer.city ? viewer.city : "").trim().toUpperCase();
  const enforceCity = viewerCity && viewerCity !== "ALL";
  const sql = viewer.permissions.dataScope === "all"
    ? `SELECT * FROM followups WHERE deleted_at IS NULL ORDER BY event_timestamp DESC, id DESC`
    : `SELECT * FROM followups
       WHERE deleted_at IS NULL
         AND (LOWER(expert) = LOWER(?) OR LOWER(created_by_username) = LOWER(?))
         ${enforceCity ? `AND (city IS NULL OR city = '' OR UPPER(city) = ?)` : ``}
       ORDER BY event_timestamp DESC, id DESC`;
  const params = viewer.permissions.dataScope === "all"
    ? []
    : (enforceCity ? [viewer.fullName, viewer.username, viewerCity] : [viewer.fullName, viewer.username]);
  const rows = await query(sql, params);
  return rows.map(mapFollowup);
}

function canViewerAccessFollowupRow(viewer, row) {
  if (!viewer || !row) return false;
  if (viewer.permissions && viewer.permissions.dataScope === "all") return true;
  const viewerCity = String(viewer.city || "").trim().toUpperCase();
  const rowCity = String(row.city || "").trim().toUpperCase();
  const sameExpert = String(row.expert || "").trim().toLowerCase() === String(viewer.fullName || "").trim().toLowerCase();
  const sameCreator = String(row.created_by_username || "").trim().toLowerCase() === String(viewer.username || "").trim().toLowerCase();
  const cityAllowed = !viewerCity || viewerCity === "ALL" || !rowCity || rowCity === viewerCity;
  return cityAllowed && (sameExpert || sameCreator);
}

async function findFollowupByServerUid(serverUid) {
  const rows = await query(
    `SELECT *
     FROM followups
     WHERE server_uid = ?
       AND deleted_at IS NULL
     LIMIT 1`,
    [serverUid]
  );
  return rows[0] || null;
}

async function findFollowupByLegacyOrFingerprint(legacyId, fingerprint) {
  const rows = await query(
    `SELECT * FROM followups
     WHERE (legacy_id IS NOT NULL AND legacy_id <> '' AND legacy_id = ?)
        OR fingerprint = ?
     LIMIT 1`,
    [legacyId || "", fingerprint]
  );
  return rows[0] || null;
}

function parseTimestampMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

async function findRecentNearDuplicate(input, windowSeconds) {
  const candidateRows = await query(
    `SELECT *
     FROM followups
     WHERE deleted_at IS NULL
       AND LOWER(expert) = LOWER(?)
       AND followup_type = ?
       AND LOWER(school_name) = LOWER(?)
     ORDER BY id DESC
     LIMIT 50`,
    [input.Expert || "", input.FollowupType || "", input.SchoolName || ""]
  );
  if (!candidateRows.length) return null;

  const targetSignature = buildFollowupNearDuplicateSignature(input);
  const targetTimestampMs = parseTimestampMs(input.Timestamp);
  const windowMs = Math.max(0, Number(windowSeconds) || 0) * 1000;

  for (const row of candidateRows) {
    const mapped = mapFollowup(row);
    if (buildFollowupNearDuplicateSignature(mapped) !== targetSignature) continue;
    if (!windowMs) return row;
    const candidateTimestampMs = parseTimestampMs(mapped.Timestamp);
    if (targetTimestampMs != null && candidateTimestampMs != null && Math.abs(targetTimestampMs - candidateTimestampMs) <= windowMs) {
      return row;
    }
  }
  return null;
}

async function upsertFollowup(input) {
  const legacyId = input.legacyId || input.ID || "";
  const fingerprint = buildFollowupFingerprint(input);
  const existing = await findFollowupByLegacyOrFingerprint(legacyId, fingerprint);
  if (existing) return mapFollowup(existing);

  const nearDuplicate = await findRecentNearDuplicate(input, 90);
  if (nearDuplicate) return mapFollowup(nearDuplicate);

  const serverUid = generateServerId("NSA-FU");
  await query(
    `INSERT INTO followups
      (server_uid, legacy_id, fingerprint, event_timestamp, expert, school_name, contact_name, contact_phone,
       followup_type, notes, outcome, next_action, next_date, cost, status, city, sector,
       school_type, category, effectif, location, contact_role, source, created_by_username, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      serverUid,
      legacyId || null,
      fingerprint,
      input.Timestamp || new Date().toISOString(),
      input.Expert || "",
      input.SchoolName || "",
      input.ContactName || "",
      input.ContactPhone || "",
      input.FollowupType || "FOLLOWUP",
      input.Notes || "",
      input.Outcome || "",
      input.NextAction || "",
      input.NextDate || "",
      input.Cost || 0,
      input.Status || "En cours",
      input.City || "",
      input.Sector || "",
      input.SchoolType || "",
      input.Category || "",
      input.Effectif || "",
      input.Location || "",
      input.ContactRole || "",
      input.Source || "nateiva-sale-analytic-api",
      input.CreatedByUsername || "",
      input.DeviceId || ""
    ]
  );
  const rows = await query(`SELECT * FROM followups WHERE server_uid = ? LIMIT 1`, [serverUid]);
  return mapFollowup(rows[0]);
}

async function updateFollowup(serverUid, viewer, input) {
  const existing = await findFollowupByServerUid(serverUid);
  if (!existing) return null;
  if (!canViewerAccessFollowupRow(viewer, existing)) {
    const denied = new Error("Accès refusé à cette entrée");
    denied.code = "FORBIDDEN";
    throw denied;
  }

  const nextRecord = {
    ID: existing.server_uid,
    LegacyID: existing.legacy_id || "",
    Timestamp: input.Timestamp || existing.event_timestamp || new Date().toISOString(),
    Expert: input.Expert || existing.expert || "",
    SchoolName: input.SchoolName || existing.school_name || "",
    ContactName: input.ContactName || "",
    ContactPhone: input.ContactPhone || "",
    FollowupType: input.FollowupType || existing.followup_type || "FOLLOWUP",
    Notes: input.Notes || "",
    Outcome: input.Outcome || "",
    NextAction: input.NextAction || "",
    NextDate: input.NextDate || "",
    Cost: input.Cost || 0,
    Status: input.Status || "En cours",
    City: input.City || "",
    Sector: input.Sector || "",
    SchoolType: input.SchoolType || "",
    Category: input.Category || "",
    Effectif: input.Effectif || "",
    Location: input.Location || "",
    ContactRole: input.ContactRole || "",
    Source: existing.source || input.Source || "nateiva-sale-analytic-api"
  };
  const fingerprint = buildFollowupFingerprint(nextRecord);
  const duplicateRows = await query(
    `SELECT server_uid
     FROM followups
     WHERE fingerprint = ?
       AND server_uid <> ?
     LIMIT 1`,
    [fingerprint, serverUid]
  );
  if (duplicateRows.length) {
    const duplicate = new Error("Cette mise à jour dupliquerait une autre entrée");
    duplicate.code = "DUPLICATE";
    throw duplicate;
  }

  await query(
    `UPDATE followups
     SET fingerprint = ?,
         event_timestamp = ?,
         expert = ?,
         school_name = ?,
         contact_name = ?,
         contact_phone = ?,
         followup_type = ?,
         notes = ?,
         outcome = ?,
         next_action = ?,
         next_date = ?,
         cost = ?,
         status = ?,
         city = ?,
         sector = ?,
         school_type = ?,
         category = ?,
         effectif = ?,
         location = ?,
         contact_role = ?,
         source = ?,
         device_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE server_uid = ?`,
    [
      fingerprint,
      nextRecord.Timestamp,
      nextRecord.Expert,
      nextRecord.SchoolName,
      nextRecord.ContactName,
      nextRecord.ContactPhone,
      nextRecord.FollowupType,
      nextRecord.Notes,
      nextRecord.Outcome,
      nextRecord.NextAction,
      nextRecord.NextDate,
      nextRecord.Cost,
      nextRecord.Status,
      nextRecord.City,
      nextRecord.Sector,
      nextRecord.SchoolType,
      nextRecord.Category,
      nextRecord.Effectif,
      nextRecord.Location,
      nextRecord.ContactRole,
      nextRecord.Source,
      input.DeviceId || existing.device_id || "",
      serverUid
    ]
  );

  const updated = await findFollowupByServerUid(serverUid);
  return updated ? mapFollowup(updated) : null;
}

async function deleteFollowup(serverUid, deletedByUsername) {
  const rows = await query(
    `SELECT * FROM followups
     WHERE server_uid = ?
     LIMIT 1`,
    [serverUid]
  );
  if (!rows.length) return null;
  await query(
    `UPDATE followups
     SET deleted_at = CURRENT_TIMESTAMP,
         deleted_by_username = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE server_uid = ?`,
    [deletedByUsername || "", serverUid]
  );
  return mapFollowup(rows[0]);
}

async function logSyncEvent(entry) {
  await query(
    `INSERT INTO sync_events (username, device_id, sync_type, payload_json)
     VALUES (?, ?, ?, ?)`,
    [entry.username || "", entry.deviceId || "", entry.syncType || "local-state", JSON.stringify(entry.payload || {})]
  );
}

// === Campagne 2027 — attribution d'écoles (claims) et demandes de réattribution ===
// schoolKeyNormalize mirrors the frontend schoolKey()/normalizeText() exactly so that the
// same school name always maps to the same key on both sides (accents stripped, lowercased,
// whitespace collapsed).
function schoolKeyNormalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function mapClaimRequest(row) {
  return {
    id: row.id,
    campaignYear: row.campaign_year,
    schoolName: row.school_name,
    schoolKey: row.school_key,
    requestedByUsername: row.requested_by_username,
    requestedByFullName: row.requested_by_fullname,
    currentOwnerFullName: row.current_owner_fullname,
    message: row.message || "",
    status: row.status,
    decidedByUsername: row.decided_by_username || "",
    decisionNote: row.decision_note || "",
    decidedAt: row.decided_at,
    createdAt: row.created_at
  };
}

// First (earliest) author of a saisie per school within the campaign window =
// the 2027 owner of that school. Computed live from the followups table so it
// can never drift from reality.
async function listCampaignClaims(campaignStartIso) {
  const rows = await query(
    `SELECT school_name, expert, created_by_username, event_timestamp
     FROM followups
     WHERE deleted_at IS NULL
       AND event_timestamp >= ?
     ORDER BY event_timestamp ASC, id ASC`,
    [campaignStartIso]
  );
  const map = new Map();
  for (const row of rows) {
    const key = schoolKeyNormalize(row.school_name);
    if (!key || map.has(key)) continue;
    map.set(key, {
      schoolKey: key,
      schoolName: row.school_name,
      owner: row.expert,
      ownerUsername: row.created_by_username || "",
      firstAt: row.event_timestamp
    });
  }
  return Array.from(map.values());
}

async function findCampaignClaimForSchool(campaignStartIso, schoolName) {
  const key = schoolKeyNormalize(schoolName);
  if (!key) return null;
  const claims = await listCampaignClaims(campaignStartIso);
  return claims.find((claim) => claim.schoolKey === key) || null;
}

async function hasApprovedClaimRequest(campaignYear, schoolName, username) {
  const key = schoolKeyNormalize(schoolName);
  const rows = await query(
    `SELECT id FROM school_claim_requests
     WHERE campaign_year = ?
       AND school_key = ?
       AND LOWER(requested_by_username) = LOWER(?)
       AND status = 'approved'
     LIMIT 1`,
    [campaignYear, key, username || ""]
  );
  return rows.length > 0;
}

async function createClaimRequest(input) {
  const key = schoolKeyNormalize(input.schoolName);
  if (!key) return null;
  // One live (pending or approved) request per user+school+campaign — no duplicates.
  const existingRows = await query(
    `SELECT * FROM school_claim_requests
     WHERE campaign_year = ?
       AND school_key = ?
       AND LOWER(requested_by_username) = LOWER(?)
       AND status IN ('pending', 'approved')
     ORDER BY id DESC
     LIMIT 1`,
    [input.campaignYear, key, input.requestedByUsername || ""]
  );
  if (existingRows.length) return mapClaimRequest(existingRows[0]);
  const result = await query(
    `INSERT INTO school_claim_requests
      (campaign_year, school_name, school_key, requested_by_username, requested_by_fullname, current_owner_fullname, message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.campaignYear,
      String(input.schoolName || "").trim(),
      key,
      input.requestedByUsername || "",
      input.requestedByFullName || "",
      input.currentOwnerFullName || "",
      input.message || ""
    ]
  );
  const rows = await query(`SELECT * FROM school_claim_requests WHERE id = ? LIMIT 1`, [result.insertId]);
  return rows.length ? mapClaimRequest(rows[0]) : null;
}

async function listClaimRequests(viewer, campaignYear) {
  const seesAll = !!(viewer && viewer.permissions && viewer.permissions.dataScope === "all") || (viewer && viewer.role === "SuperAdmin");
  const rows = seesAll
    ? await query(
        `SELECT * FROM school_claim_requests WHERE campaign_year = ? ORDER BY FIELD(status,'pending','approved','denied'), id DESC`,
        [campaignYear]
      )
    : await query(
        `SELECT * FROM school_claim_requests
         WHERE campaign_year = ? AND LOWER(requested_by_username) = LOWER(?)
         ORDER BY id DESC`,
        [campaignYear, viewer ? viewer.username : ""]
      );
  return rows.map(mapClaimRequest);
}

async function decideClaimRequest(id, viewer, decision, note) {
  const rows = await query(`SELECT * FROM school_claim_requests WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) return null;
  const status = decision === "approved" ? "approved" : "denied";
  await query(
    `UPDATE school_claim_requests
     SET status = ?, decided_by_username = ?, decision_note = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, viewer ? viewer.username : "", note || "", id]
  );
  const updated = await query(`SELECT * FROM school_claim_requests WHERE id = ? LIMIT 1`, [id]);
  return updated.length ? mapClaimRequest(updated[0]) : null;
}

// === Planning terrain / bureau (décidé par le Sub Admin pour son équipe) ===
function mapScheduleRow(row) {
  return {
    memberUsername: row.member_username,
    memberFullName: row.member_fullname,
    date: row.work_date instanceof Date ? row.work_date.toISOString().slice(0, 10) : String(row.work_date).slice(0, 10),
    dayType: row.day_type,
    setBy: row.set_by_username || ""
  };
}

async function listWorkSchedules(viewer, fromDate, toDate) {
  const seesAll = !!(viewer && viewer.permissions && viewer.permissions.dataScope === "all") || (viewer && (viewer.role === "SuperAdmin" || viewer.role === "SubAdmin"));
  const rows = seesAll
    ? await query(`SELECT * FROM work_schedules WHERE work_date BETWEEN ? AND ? ORDER BY work_date ASC`, [fromDate, toDate])
    : await query(
        `SELECT * FROM work_schedules
         WHERE work_date BETWEEN ? AND ?
           AND (LOWER(member_username) = LOWER(?) OR LOWER(member_fullname) = LOWER(?))
         ORDER BY work_date ASC`,
        [fromDate, toDate, viewer ? viewer.username : "", viewer ? viewer.fullName : ""]
      );
  return rows.map(mapScheduleRow);
}

async function setWorkSchedules(viewer, entries) {
  const results = [];
  for (const e of entries || []) {
    const username = String(e.memberUsername || "").trim();
    const date = String(e.date || "").slice(0, 10);
    const dayType = String(e.dayType || "").trim();
    if (!username || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (dayType === "clear") {
      await query(`DELETE FROM work_schedules WHERE LOWER(member_username) = LOWER(?) AND work_date = ?`, [username, date]);
      results.push({ memberUsername: username, date, dayType: "clear" });
      continue;
    }
    if (dayType !== "field" && dayType !== "office") continue;
    await query(
      `INSERT INTO work_schedules (member_username, member_fullname, work_date, day_type, set_by_username)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE member_fullname = VALUES(member_fullname), day_type = VALUES(day_type), set_by_username = VALUES(set_by_username), updated_at = CURRENT_TIMESTAMP`,
      [username, String(e.memberFullName || "").trim(), date, dayType, viewer ? viewer.username : ""]
    );
    results.push({ memberUsername: username, date, dayType });
  }
  return results;
}

async function getDayTypeFor(username, dateStr) {
  const rows = await query(
    `SELECT day_type FROM work_schedules WHERE LOWER(member_username) = LOWER(?) AND work_date = ? LIMIT 1`,
    [username || "", String(dateStr || "").slice(0, 10)]
  );
  return rows.length ? rows[0].day_type : "";
}

// === Documents & notes par école ===
function mapDocument(row) {
  return {
    id: row.id, schoolKey: row.school_key, schoolName: row.school_name, kind: row.kind,
    title: row.title || '', note: row.note || '', fileName: row.file_name || '', mime: row.mime || '',
    sizeBytes: row.size_bytes || 0, clientRef: row.client_ref || '',
    createdByUsername: row.created_by_username, createdByFullName: row.created_by_fullname || '',
    createdAt: row.created_at
  };
}
async function insertDocument(input) {
  const result = await query(
    `INSERT INTO school_documents (school_key, school_name, kind, title, note, file_name, mime, size_bytes, storage_path, client_ref, created_by_username, created_by_fullname)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [schoolKeyNormalize(input.schoolName), String(input.schoolName || '').trim(), input.kind, input.title || '', input.note || null,
     input.fileName || '', input.mime || '', input.sizeBytes || 0, input.storagePath || '', input.clientRef || '',
     input.createdByUsername, input.createdByFullName || '']
  );
  const rows = await query(`SELECT * FROM school_documents WHERE id = ? LIMIT 1`, [result.insertId]);
  return rows.length ? mapDocument(rows[0]) : null;
}
async function listDocumentsForSchool(schoolName) {
  const rows = await query(
    `SELECT * FROM school_documents WHERE school_key = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
    [schoolKeyNormalize(schoolName)]
  );
  return rows.map(mapDocument);
}
async function getDocumentRow(id) {
  const rows = await query(`SELECT * FROM school_documents WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [id]);
  return rows.length ? rows[0] : null;
}
async function softDeleteDocument(id) {
  await query(`UPDATE school_documents SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
}

// === Villes & quartiers ajoutés / supprimés par l'équipe ===
function geoKeyNormalize(x) {
  return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
function mapGeoPlace(row) {
  return {
    id: row.id, kind: row.kind, action: row.action, region: row.region || '', cityKey: row.city_key || '',
    name: row.name, nameKey: row.name_key, lat: row.lat == null ? null : Number(row.lat), lng: row.lng == null ? null : Number(row.lng),
    by: row.created_by_fullname || row.created_by_username || '', byUsername: row.created_by_username || '',
    updatedBy: row.updated_by_username || '', at: row.updated_at || row.created_at
  };
}
async function listGeoPlaces() {
  const rows = await query(`SELECT * FROM geo_places ORDER BY kind, city_key, name_key`);
  return rows.map(mapGeoPlace);
}
async function getGeoPlace(kind, cityKey, nameKey) {
  const rows = await query(`SELECT * FROM geo_places WHERE kind = ? AND city_key = ? AND name_key = ? LIMIT 1`, [kind, cityKey, nameKey]);
  return rows.length ? mapGeoPlace(rows[0]) : null;
}
async function upsertGeoPlace(input) {
  await query(
    `INSERT INTO geo_places (kind, action, region, city_key, name, name_key, lat, lng, created_by_username, created_by_fullname, updated_by_username)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE action = VALUES(action),
       region = IF(VALUES(region) = '', region, VALUES(region)),
       name = IF(VALUES(action) = 'add', VALUES(name), name),
       lat = COALESCE(VALUES(lat), lat), lng = COALESCE(VALUES(lng), lng),
       updated_by_username = VALUES(updated_by_username)`,
    [input.kind, input.action, input.region || '', input.cityKey, input.name, input.nameKey,
     input.lat == null ? null : input.lat, input.lng == null ? null : input.lng,
     input.username || '', input.fullName || '', input.username || '']
  );
  return getGeoPlace(input.kind, input.cityKey, input.nameKey);
}

async function getBootstrapPayload(viewer, extra) {
  const campaignStartIso = (extra && extra.campaignStartIso) || "2027-01-01T00:00:00";
  const campaignYear = (extra && extra.campaignYear) || 2027;
  let campaignClaims = [];
  let claimRequests = [];
  let workSchedules = [];
  try {
    campaignClaims = await listCampaignClaims(campaignStartIso);
    claimRequests = await listClaimRequests(viewer, campaignYear);
  } catch (e) {
    // Claims table not migrated yet — bootstrap must keep working.
    campaignClaims = [];
    claimRequests = [];
  }
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 60 * 86400000).toISOString().slice(0, 10);
    workSchedules = await listWorkSchedules(viewer, from, to);
  } catch (e) {
    workSchedules = []; // table pas encore migrée
  }
  let geoPlaces = [];
  try { geoPlaces = await listGeoPlaces(); } catch (e) { geoPlaces = []; } // table pas encore migrée
  return {
    user: viewer,
    users: await listUsers(),
    geoPlaces,
    followups: await listVisibleFollowups(viewer),
    campaignClaims,
    claimRequests,
    workSchedules,
    campaign: { year: campaignYear, startIso: campaignStartIso },
    meta: Object.assign(
      {
        backendProject: "nateiva-sale-analytic-api",
        syncedAt: new Date().toISOString()
      },
      extra || {}
    )
  };
}

module.exports = {
  geoKeyNormalize,
  listGeoPlaces,
  getGeoPlace,
  upsertGeoPlace,
  defaultPermissionsForRole,
  findUserByUsername,
  listUsers,
  createUser,
  updateUserAccess,
  upsertFollowup,
  updateFollowup,
  deleteFollowup,
  logSyncEvent,
  getBootstrapPayload,
  schoolKeyNormalize,
  listCampaignClaims,
  findCampaignClaimForSchool,
  hasApprovedClaimRequest,
  createClaimRequest,
  listClaimRequests,
  decideClaimRequest,
  listWorkSchedules,
  setWorkSchedules,
  getDayTypeFor,
  insertDocument,
  listDocumentsForSchool,
  getDocumentRow,
  softDeleteDocument
};
