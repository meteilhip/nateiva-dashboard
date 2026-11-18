const express = require("express");
const cors = require("cors");
const { port, allowedOrigins, defaultCallCount, apiName } = require("./config");
const { comparePassword, createToken, verifyToken, hashPassword } = require("./auth");
const { findUserByUsername, createUser, updateUserAccess, upsertFollowup, updateFollowup, deleteFollowup, logSyncEvent, getBootstrapPayload, findCampaignClaimForSchool, hasApprovedClaimRequest, createClaimRequest, listClaimRequests, decideClaimRequest } = require("./repository");
const { normalizeRole, normalizePermissions } = require("./utils");

const app = express();

function isAllowedOrigin(origin) {
  if (!origin || !allowedOrigins.length) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (/^https:\/\/nateiva-sale-analytic-api\.[^/]+\.sslip\.io$/i.test(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)) return true;
  return false;
}

app.use(express.json({ limit: "5mb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: false
  })
);

function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });
    const payload = verifyToken(token);
    req.auth = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
}

async function loadViewer(req) {
  const viewer = await findUserByUsername(req.auth.username, false);
  if (!viewer || !viewer.active) {
    throw new Error("User is not active");
  }
  return viewer;
}

function canManageUsers(viewer) {
  return !!(viewer && viewer.permissions && viewer.permissions.manageUsers);
}

function canManageAccess(viewer) {
  return !!viewer && viewer.role === "SuperAdmin" && String(viewer.username || "").trim().toLowerCase() === "noah";
}

function canDeleteFollowup(viewer) {
  return !!viewer && viewer.role === "SuperAdmin" && String(viewer.username || "").trim().toLowerCase() === "noah";
}

// === Campagne 2027 — fresh start + attribution exclusive ===
// CAMPAIGN_START_ISO: every saisie dated on/after this instant belongs to the 2027
// campaign. The FIRST member to log a note on a school in 2027 owns that school for
// the campaign; anyone else must hold an approved claim request (demande validée par
// le Super Admin) before the server accepts their saisie on it.
const CAMPAIGN_YEAR = Number(process.env.NATEIVA_CAMPAIGN_YEAR || 2027);
const CAMPAIGN_START_ISO = process.env.NATEIVA_CAMPAIGN_START || `${CAMPAIGN_YEAR}-01-01T00:00:00`;

function isCampaignTimestamp(ts) {
  const ms = Date.parse(String(ts || ""));
  const startMs = Date.parse(CAMPAIGN_START_ISO);
  return Number.isFinite(ms) && Number.isFinite(startMs) && ms >= startMs;
}

function isSuperAdminViewer(viewer) {
  return !!viewer && viewer.role === "SuperAdmin";
}

// Returns null when allowed, or an error message when the 2027 lock blocks the save.
async function checkCampaignLock(viewer, schoolName, timestamp) {
  if (!isCampaignTimestamp(timestamp)) return null; // pre-2027 entries follow the old rules
  if (isSuperAdminViewer(viewer)) return null; // Super Admin bypasses the lock
  const claim = await findCampaignClaimForSchool(CAMPAIGN_START_ISO, schoolName);
  if (!claim) return null; // unclaimed school — this save claims it
  const sameExpert = String(claim.owner || "").trim().toLowerCase() === String(viewer.fullName || "").trim().toLowerCase();
  const sameCreator = String(claim.ownerUsername || "").trim().toLowerCase() === String(viewer.username || "").trim().toLowerCase();
  if (sameExpert || sameCreator) return null; // the 2027 owner
  const approved = await hasApprovedClaimRequest(CAMPAIGN_YEAR, schoolName, viewer.username);
  if (approved) return null; // Super Admin already granted access
  return `École déjà attribuée à ${claim.owner} pour la campagne ${CAMPAIGN_YEAR}. Envoyez une demande d'attribution au Super Admin.`;
}

app.get("/health", function healthHandler(req, res) {
  res.json({
    success: true,
    project: apiName,
    callsDefault: defaultCallCount,
    now: new Date().toISOString()
  });
});

app.post("/api/auth/login", async function loginHandler(req, res) {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await findUserByUsername(username, true);
    if (!user || !user.active) {
      return res.status(401).json({ success: false, error: "Identifiants incorrects" });
    }
    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, error: "Identifiants incorrects" });
    }
    const token = createToken({
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.fullName
    });
    delete user.passwordHash;
    return res.json({ success: true, token, user });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/bootstrap", authRequired, async function bootstrapHandler(req, res) {
  try {
    const viewer = await loadViewer(req);
    const payload = await getBootstrapPayload(viewer, { callsDefault: defaultCallCount, campaignYear: CAMPAIGN_YEAR, campaignStartIso: CAMPAIGN_START_ISO });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/followups", authRequired, async function createFollowupHandler(req, res) {
  try {
    const viewer = await loadViewer(req);
    const lockError = await checkCampaignLock(
      viewer,
      req.body.schoolName || req.body.SchoolName || "",
      req.body.timestamp || req.body.Timestamp || new Date().toISOString()
    );
    if (lockError) {
      return res.status(403).json({ success: false, error: lockError, code: "SCHOOL_LOCKED" });
    }
    const followup = await upsertFollowup({
      ...req.body,
      Timestamp: req.body.timestamp || req.body.Timestamp || new Date().toISOString(),
      Expert: req.body.expert || req.body.Expert || viewer.fullName,
      SchoolName: req.body.schoolName || req.body.SchoolName || "",
      ContactName: req.body.contactName || req.body.ContactName || "",
      ContactPhone: req.body.contactPhone || req.body.ContactPhone || "",
      FollowupType: req.body.followupType || req.body.FollowupType || "FOLLOWUP",
      Notes: req.body.notes || req.body.Notes || "",
      Outcome: req.body.outcome || req.body.Outcome || "",
      NextAction: req.body.nextAction || req.body.NextAction || "",
      NextDate: req.body.nextDate || req.body.NextDate || "",
      Cost: req.body.cost || req.body.Cost || 0,
      Status: req.body.status || req.body.Status || "En cours",
      City: req.body.city || req.body.City || "",
      Sector: req.body.sector || req.body.Sector || "",
      SchoolType: req.body.schoolType || req.body.SchoolType || "",
      Category: req.body.category || req.body.Category || "",
      Effectif: req.body.effectif || req.body.Effectif || "",
      Location: req.body.location || req.body.Location || "",
      ContactRole: req.body.contactRole || req.body.ContactRole || "",
      CreatedByUsername: viewer.username,
      DeviceId: req.body.deviceId || ""
    });
    return res.json({ success: true, followup });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.put("/api/followups/:id", authRequired, async function updateFollowupHandler(req, res) {
  try {
    const viewer = await loadViewer(req);
    const followup = await updateFollowup(String(req.params.id || "").trim(), viewer, {
      ...req.body,
      Timestamp: req.body.timestamp || req.body.Timestamp || new Date().toISOString(),
      Expert: req.body.expert || req.body.Expert || viewer.fullName,
      SchoolName: req.body.schoolName || req.body.SchoolName || "",
      ContactName: req.body.contactName || req.body.ContactName || "",
      ContactPhone: req.body.contactPhone || req.body.ContactPhone || "",
      FollowupType: req.body.followupType || req.body.FollowupType || "FOLLOWUP",
      Notes: req.body.notes || req.body.Notes || "",
      Outcome: req.body.outcome || req.body.Outcome || "",
      NextAction: req.body.nextAction || req.body.NextAction || "",
      NextDate: req.body.nextDate || req.body.NextDate || "",
      Cost: req.body.cost || req.body.Cost || 0,
      Status: req.body.status || req.body.Status || "En cours",
      City: req.body.city || req.body.City || "",
      Sector: req.body.sector || req.body.Sector || "",
      SchoolType: req.body.schoolType || req.body.SchoolType || "",
      Category: req.body.category || req.body.Category || "",
      Effectif: req.body.effectif || req.body.Effectif || "",
      Location: req.body.location || req.body.Location || "",
      ContactRole: req.body.contactRole || req.body.ContactRole || "",
      DeviceId: req.body.deviceId || ""
    });
    if (!followup) {
      return res.status(404).json({ success: false, error: "Entrée introuvable" });
    }
    return res.json({ success: true, followup, message: "Suivi mis à jour avec succès" });
  } catch (error) {
    if (error && error.code === "FORBIDDEN") {
      return res.status(403).json({ success: false, error: error.message });
    }
    if (error && error.code === "DUPLICATE") {
      return res.status(409).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/followups/:id", authRequired, async function deleteFollowupHandler(req, res) {
  try {
    const viewer = await loadViewer(req);
    if (!canDeleteFollowup(viewer)) {
      return res.status(403).json({ success: false, error: "Seul Noah peut supprimer une entrÃ©e" });
    }
    const deleted = await deleteFollowup(String(req.params.id || "").trim(), viewer.username);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "EntrÃ©e introuvable" });
    }
    return res.json({ success: true, message: "EntrÃ©e supprimÃ©e", followup: deleted });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/users", authRequired, async function createUserHandler(req, res) {
  try {
    const viewer = await loadViewer(req);
    if (!canManageUsers(viewer)) {
      return res.status(403).json({ success: false, error: "Accès réservé à la gestion utilisateurs" });
    }
    const role = normalizeRole(req.body.role);
    if (role !== "Expert" && viewer.role !== "SuperAdmin") {
      return res.status(403).json({ success: false, error: "Seul le Super Admin peut créer ce rôle" });
    }
    const username = String(req.body.username || "").trim().toLowerCase();
    const existing = await findUserByUsername(username, false);
    if (existing) {
      return res.status(409).json({ success: false, error: "Ce nom d'utilisateur existe déjà" });
    }
    const user = await createUser({
      username,
      passwordHash: await hashPassword(String(req.body.password || "")),
      fullName: String(req.body.fullName || "").trim(),
      city: String(req.body.city || "DOUALA").trim(),
      role,
      permissions: normalizePermissions({ role, permissions: req.body.permissions || null })
    });
    return res.json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/users/access", authRequired, async function updateAccessHandler(req, res) {
  try {
    const viewer = await loadViewer(req);
    if (!canManageAccess(viewer)) {
      return res.status(403).json({ success: false, error: "Accès réservé au Super Admin" });
    }
    const user = await updateUserAccess(String(req.body.username || "").trim().toLowerCase(), {
      dataScope: req.body.dataScope,
      manageUsers: !!req.body.manageUsers,
      panes: Array.isArray(req.body.panes) ? req.body.panes : []
    });
    if (!user) {
      return res.status(404).json({ success: false, error: "Utilisateur introuvable" });
    }
    return res.json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// === Campagne 2027 — demandes d'attribution d'école ===
app.get("/api/claims/requests", authRequired, async function listClaimRequestsHandler(req, res) {
  try {
    const viewer = await loadViewer(req);
    const requests = await listClaimRequests(viewer, CAMPAIGN_YEAR);
    return res.json({ success: true, requests, campaign: { year: CAMPAIGN_YEAR, startIso: CAMPAIGN_START_ISO } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/claims/requests", authRequired, async function createClaimRequestHandler(req, res) {
  try {
    const viewer = await loadViewer(req);
    const schoolName = String(req.body.schoolName || "").trim();
    if (!schoolName) {
      return res.status(400).json({ success: false, error: "Nom d'école requis" });
    }
    const claim = await findCampaignClaimForSchool(CAMPAIGN_START_ISO, schoolName);
    const request = await createClaimRequest({
      campaignYear: CAMPAIGN_YEAR,
      schoolName,
      requestedByUsername: viewer.username,
      requestedByFullName: viewer.fullName,
      currentOwnerFullName: claim ? claim.owner : "",
      message: String(req.body.message || "").trim()
    });
    if (!request) {
      return res.status(400).json({ success: false, error: "Demande invalide" });
    }
    return res.json({ success: true, request });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/claims/requests/:id/decision", authRequired, async function decideClaimRequestHandler(req, res) {
  try {
    const viewer = await loadViewer(req);
    if (!isSuperAdminViewer(viewer)) {
      return res.status(403).json({ success: false, error: "Seul le Super Admin peut décider d'une demande d'attribution" });
    }
    const decision = String(req.body.decision || "").trim().toLowerCase();
    if (decision !== "approved" && decision !== "denied") {
      return res.status(400).json({ success: false, error: "Décision invalide (approved | denied)" });
    }
    const request = await decideClaimRequest(Number(req.params.id), viewer, decision, String(req.body.note || "").trim());
    if (!request) {
      return res.status(404).json({ success: false, error: "Demande introuvable" });
    }
    return res.json({ success: true, request });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/sync/local-state", authRequired, async function syncLocalStateHandler(req, res) {
  try {
    const viewer = await loadViewer(req);
    const followups = Array.isArray(req.body.followups) ? req.body.followups : [];
    const invitedUsers = Array.isArray(req.body.invitedUsers) ? req.body.invitedUsers : [];
    const userOverrides = req.body.userOverrides && typeof req.body.userOverrides === "object" ? req.body.userOverrides : {};
    const deviceId = String(req.body.deviceId || "");

    let syncedFollowups = 0;
    for (const item of followups) {
      await upsertFollowup({
        ...item,
        CreatedByUsername: viewer.username,
        DeviceId: deviceId,
        Source: "browser-local-sync"
      });
      syncedFollowups += 1;
    }

    let syncedUsers = 0;
    if (canManageUsers(viewer)) {
      for (const item of invitedUsers) {
        const username = String(item.username || "").trim().toLowerCase();
        if (!username) continue;
        const existing = await findUserByUsername(username, false);
        if (!existing) {
          const role = normalizeRole(item.role);
          if (role !== "Expert" && viewer.role !== "SuperAdmin") continue;
          await createUser({
            username,
            passwordHash: await hashPassword(String(item.password || "ChangeMe123!")),
            fullName: String(item.fullName || username).trim(),
            city: String(item.city || "DOUALA").trim(),
            role,
            permissions: normalizePermissions({ role, permissions: item.permissions || null })
          });
          syncedUsers += 1;
        }
      }
    }

    let syncedAccess = 0;
    if (canManageAccess(viewer)) {
      for (const username of Object.keys(userOverrides)) {
        const record = userOverrides[username];
        if (!record || !record.permissions) continue;
        await updateUserAccess(username, {
          dataScope: record.permissions.dataScope,
          manageUsers: !!record.permissions.manageUsers,
          panes: Array.isArray(record.permissions.panes) ? record.permissions.panes : []
        });
        syncedAccess += 1;
      }
    }

    await logSyncEvent({
      username: viewer.username,
      deviceId,
      syncType: "local-state",
      payload: {
        followups: followups.length,
        invitedUsers: invitedUsers.length,
        userOverrides: Object.keys(userOverrides).length
      }
    });

    const payload = await getBootstrapPayload(viewer, {
      syncSummary: { syncedFollowups, syncedUsers, syncedAccess }
    });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, function onListen() {
  console.log(`${apiName} listening on port ${port}`);
});
