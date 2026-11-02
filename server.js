import "dotenv/config";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_BASE = "https://zernio.com/api";
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const sessions = new Map();

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"], imgSrc: ["'self'", "data:", "blob:", "https:"],
    mediaSrc: ["'self'", "blob:"], connectSrc: ["'self'", "https://zernio.com", "https://media.zernio.com", "https://*.r2.cloudflarestorage.com"]
  }}
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function cookieValue(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `rouupatch_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`);
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `rouupatch_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}
function getSession(req) {
  const token = cookieValue(req, "rouupatch_session");
  return token ? sessions.get(token) : null;
}
function requireLogin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Please log in with your Zernio API key." });
  req.zernioKey = session.apiKey;
  req.profileId = session.profileId;
  next();
}
async function zernioRequest(apiKey, endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${apiKey}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || `Zernio returned HTTP ${response.status}`;
    const error = new Error(typeof message === "string" ? message : JSON.stringify(message));
    error.status = response.status;
    throw error;
  }
  return data?.data ?? data;
}
function pickProfile(data) {
  const profiles = data?.profiles || (Array.isArray(data) ? data : []);
  const profile = profiles.find(p => p.isDefault || p.is_default) || profiles[0];
  const profileId = profile?._id || profile?.id || profile?.profileId;
  if (!profileId) throw new Error("No Zernio profile was found for this API key. Create a profile in Zernio and try again.");
  return { profileId, profileName: profile.name || profile.displayName || "Default profile", profileCount: profiles.length };
}

app.get("/api/health", (req, res) => {
  const session = getSession(req);
  res.json({ authenticated: Boolean(session), app: "ROUUPATCH", platform: "tiktok", profileName: session?.profileName || null });
});

app.post("/api/login", async (req, res) => {
  const apiKey = String(req.body?.apiKey || "").trim();
  if (!apiKey || !/^(sk_|zrk_)/.test(apiKey)) return res.status(400).json({ error: "Enter a valid-looking Zernio API key." });
  try {
    const profilesData = await zernioRequest(apiKey, "/v1/profiles");
    const selected = pickProfile(profilesData);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { apiKey, ...selected, createdAt: Date.now() });
    setSessionCookie(res, token);
    res.json({ success: true, profileName: selected.profileName, profileCount: selected.profileCount });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not verify your Zernio API key." });
  }
});

app.post("/api/logout", (req, res) => {
  const token = cookieValue(req, "rouupatch_session");
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get("/api/accounts", requireLogin, async (req, res) => {
  try {
    const query = new URLSearchParams({ profileId: req.profileId, platform: "tiktok" });
    const result = await zernioRequest(req.zernioKey, `/v1/accounts?${query}`);
    const accounts = (result?.accounts || []).filter(a => a.platform === "tiktok" && a.isActive !== false);
    res.json({ accounts: accounts.map(a => ({ accountId: a.accountId || a._id || a.id, username: a.username || a.displayName || "TikTok account", displayName: a.displayName || a.username || "TikTok account", profileUrl: a.profileUrl || null })) });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

app.get("/api/connect", requireLogin, async (req, res) => {
  try {
    const query = new URLSearchParams({ profileId: req.profileId, redirect_url: `${APP_BASE_URL}/oauth/callback` });
    const result = await zernioRequest(req.zernioKey, `/v1/connect/tiktok?${query}`);
    if (!result?.authUrl) throw new Error("Zernio did not return an authorization URL.");
    res.json({ authUrl: result.authUrl });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

app.get("/oauth/callback", (req, res) => {
  const params = new URLSearchParams();
  for (const key of ["connected", "accountId", "username", "profileId", "error", "error_description"]) if (typeof req.query[key] === "string") params.set(key, req.query[key]);
  res.redirect(`/?${params.toString()}`);
});

app.get("/api/creator-info/:accountId", requireLogin, async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.accountId);
    res.json(await zernioRequest(req.zernioKey, `/v1/accounts/${id}/tiktok/creator-info?mediaType=video`));
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

app.post("/api/media/presign", requireLogin, async (req, res) => {
  try {
    const { filename, contentType, size } = req.body || {};
    if (!filename || !contentType || !Number.isFinite(Number(size))) return res.status(400).json({ error: "filename, contentType and size are required." });
    if (!contentType.startsWith("video/")) return res.status(400).json({ error: "Please choose a video file." });
    if (Number(size) > 4 * 1024 * 1024 * 1024) return res.status(413).json({ error: "TikTok videos must be no larger than 4 GB." });
    const result = await zernioRequest(req.zernioKey, "/v1/media/presign", { method: "POST", body: JSON.stringify({ filename, contentType, size: Number(size) }) });
    if (!result?.uploadUrl || !result?.publicUrl) throw new Error("Zernio did not return upload and public media URLs.");
    res.json({ uploadUrl: result.uploadUrl, publicUrl: result.publicUrl, expiresIn: result.expiresIn });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

app.post("/api/publish", requireLogin, async (req, res) => {
  try {
    const { accountId, publicUrl, caption, privacyLevel, allowComment, allowDuet, allowStitch, contentPreviewConfirmed, expressConsentGiven } = req.body || {};
    if (!accountId || !publicUrl || !caption?.trim() || !privacyLevel) return res.status(400).json({ error: "Account, uploaded video, caption and privacy level are required." });
    if (!contentPreviewConfirmed || !expressConsentGiven) return res.status(400).json({ error: "Confirm the preview and TikTok publishing consent before publishing." });
    if (caption.length > 2200) return res.status(400).json({ error: "TikTok captions can contain up to 2,200 characters." });
    const creator = await zernioRequest(req.zernioKey, `/v1/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info?mediaType=video`);
    const allowed = (creator?.privacyLevels || []).map(item => item.value);
    if (!allowed.includes(privacyLevel)) return res.status(400).json({ error: "That privacy option is not available for this TikTok account." });
    const interaction = creator?.postingLimits?.interactionSettings || {};
    for (const [key, value] of Object.entries({ allow_comment: allowComment, allow_duet: allowDuet, allow_stitch: allowStitch })) {
      if (interaction[key]?.enabled === false && value === true) return res.status(400).json({ error: `TikTok has disabled ${key.replace("allow_", "")} for this account.` });
    }
    const payload = { content: caption.trim(), mediaItems: [{ url: publicUrl, type: "video" }], platforms: [{ platform: "tiktok", accountId }], tiktokSettings: { privacy_level: privacyLevel, allow_comment: Boolean(allowComment), allow_duet: Boolean(allowDuet), allow_stitch: Boolean(allowStitch), content_preview_confirmed: true, express_consent_given: true }, publishNow: true };
    const result = await zernioRequest(req.zernioKey, "/v1/posts", { method: "POST", body: JSON.stringify(payload) });
    res.status(201).json({ post: result?.post || result });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`ROUUPATCH is running on port ${PORT}`));
