const crypto = require("crypto");

const ALL_PANES = ["home", "suivi", "metrics", "team", "market", "playbook", "intel", "glossary"];

function normalizeRole(role) {
  const value = String(role || "Expert").trim().toLowerCase();
  if (value === "superadmin" || value === "super admin") return "SuperAdmin";
  if (value === "subadmin" || value === "sub admin") return "SubAdmin";
  return "Expert";
}

function isNoahAccount(userLike) {
  if (!userLike) return false;
  const username = String(userLike.username || "").trim().toLowerCase();
  const fullName = String(userLike.fullName || userLike.full_name || "").trim().toLowerCase();
  return username === "noah" || fullName === "noah";
}

function defaultPermissionsForRole(userLike) {
  const normalized = normalizeRole(userLike && userLike.role ? userLike.role : userLike);
  const isPrivileged = normalized === "SuperAdmin" || normalized === "SubAdmin";
  const isNoah = isNoahAccount(userLike);
  return {
    dataScope: normalized === "SuperAdmin" && isNoah ? "all" : "own",
    manageUsers: normalized === "SuperAdmin" && isNoah,
    panes: normalized === "Expert" ? ["home", "suivi", "glossary"] : ALL_PANES.slice()
  };
}

function normalizePermissions(userLike) {
  const defaults = defaultPermissionsForRole(userLike || {});
  const incoming = userLike && userLike.permissions ? userLike.permissions : {};
  const isNoah = isNoahAccount(userLike);
  return {
    dataScope: isNoah && incoming.dataScope === "all" ? "all" : defaults.dataScope,
    manageUsers: defaults.manageUsers,
    panes: Array.isArray(incoming.panes) && incoming.panes.length ? incoming.panes.filter((pane) => ALL_PANES.includes(pane)) : defaults.panes
  };
}

function samePerson(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function digitsOnly(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeFollowupValue(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function splitFollowupNotes(noteText) {
  const marker = "[NATEIVA_META]";
  const fullText = String(noteText || "");
  const markerIndex = fullText.lastIndexOf(marker);
  if (markerIndex < 0) return { text: fullText.trim(), meta: {} };
  const plainText = fullText.slice(0, markerIndex).trim();
  const rawMeta = fullText.slice(markerIndex + marker.length).trim();
  try {
    const parsed = JSON.parse(rawMeta);
    return { text: plainText, meta: parsed && typeof parsed === "object" ? parsed : {} };
  } catch (error) {
    return { text: fullText.trim(), meta: {} };
  }
}

function buildFollowupNearDuplicateSignature(item) {
  const split = splitFollowupNotes(item.Notes || "");
  const base = [
    item.Expert || "",
    item.SchoolName || "",
    item.ContactName || "",
    digitsOnly(item.ContactPhone || ""),
    item.FollowupType || "",
    split.text || "",
    item.Outcome || "",
    item.NextAction || "",
    item.NextDate || "",
    item.Status || "",
    item.City || "",
    item.ContactRole || ""
  ].map(normalizeFollowupValue).join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function buildFollowupFingerprint(item) {
  const base = [
    item.Timestamp || "",
    item.Expert || "",
    item.SchoolName || "",
    item.ContactName || "",
    item.ContactPhone || "",
    item.FollowupType || "",
    item.Notes || "",
    item.Outcome || "",
    item.NextAction || "",
    item.NextDate || "",
    item.Status || ""
  ].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function generateServerId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function boolToTiny(value) {
  return value ? 1 : 0;
}

module.exports = {
  ALL_PANES,
  normalizeRole,
  isNoahAccount,
  defaultPermissionsForRole,
  normalizePermissions,
  samePerson,
  digitsOnly,
  splitFollowupNotes,
  buildFollowupNearDuplicateSignature,
  buildFollowupFingerprint,
  generateServerId,
  boolToTiny
};
