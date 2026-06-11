const { query } = require("./db");
const { defaultPermissionsForRole, normalizePermissions, buildFollowupFingerprint, buildFollowupNearDuplicateSignature, generateServerId, boolToTiny, normalizeRole } = require("./utils");

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    city: row.city,
    active: !!row.active,
    permissions: {
      dataScope: row.data_scope,
      manageUsers: !!row.manage_users,
      panes: JSON.parse(row.panes_json || "[]")
    }
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
  const sql = viewer.permissions.dataScope === "all"
    ? `SELECT * FROM followups WHERE deleted_at IS NULL ORDER BY event_timestamp DESC, id DESC`
    : `SELECT * FROM followups WHERE deleted_at IS NULL AND (LOWER(expert) = LOWER(?) OR LOWER(created_by_username) = LOWER(?)) ORDER BY event_timestamp DESC, id DESC`;
  const params = viewer.permissions.dataScope === "all" ? [] : [viewer.fullName, viewer.username];
  const rows = await query(sql, params);
  return rows.map(mapFollowup);
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

async function getBootstrapPayload(viewer, extra) {
  return {
    user: viewer,
    users: await listUsers(),
    followups: await listVisibleFollowups(viewer),
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
  defaultPermissionsForRole,
  findUserByUsername,
  listUsers,
  createUser,
  updateUserAccess,
  upsertFollowup,
  deleteFollowup,
  logSyncEvent,
  getBootstrapPayload
};
