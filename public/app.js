const $ = (id) => document.getElementById(id);
const state = { file: null, previewUrl: null, account: null, creatorInfo: null, publicUrl: null, busy: false };

function showNotice(message, type = "info") {
  const el = $("notice");
  el.textContent = message;
  el.className = `notice ${type}`;
}
function hideNotice() { $("notice").className = "notice hidden"; }
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function setBusy(value) {
  state.busy = value;
  $("publishButton").disabled = value || !canPublish();
  $("publishButton").querySelector("span:first-child").textContent = value ? "Publishing..." : "Publish to TikTok";
}
function canPublish() {
  return Boolean(state.file && state.account && $("caption").value.trim() &&
    $("privacySelect").value && $("previewConsent").checked && $("expressConsent").checked && !state.busy);
}
function updatePublishButton() {
  $("publishButton").disabled = !canPublish();
}
function setAccount(account) {
  state.account = account;
  $("accountEmpty").classList.toggle("hidden", Boolean(account));
  $("accountConnected").classList.toggle("hidden", !account);
  $("accountName").textContent = account ? `@${account.username.replace(/^@/, "")}` : "@tiktok";
  $("privacySelect").disabled = !account;
  if (account) loadCreatorInfo(account.accountId);
  else {
    state.creatorInfo = null;
    $("privacySelect").innerHTML = "<option>Connect an account first</option>";
  }
  updatePublishButton();
}
async function loadCreatorInfo(accountId) {
  try {
    const info = await api(`/api/creator-info/${encodeURIComponent(accountId)}`);
    state.creatorInfo = info;
    const levels = info.privacyLevels || [];
    $("privacySelect").innerHTML = "";
    for (const level of levels) {
      const option = document.createElement("option");
      option.value = level.value;
      option.textContent = level.label || level.value;
      $("privacySelect").append(option);
    }
    if (!levels.length) {
      $("privacySelect").innerHTML = "<option value=''>No privacy options returned</option>";
    }
    const interactions = info.postingLimits?.interactionSettings || {};
    for (const [key, id] of [["allow_comment", "allowComment"], ["allow_duet", "allowDuet"], ["allow_stitch", "allowStitch"]]) {
      const control = $(id);
      const setting = interactions[key];
      control.disabled = setting?.enabled === false;
      if (setting && typeof setting.default === "boolean") control.checked = setting.default;
    }
    updatePublishButton();
  } catch (error) {
    showNotice(`Could not load TikTok creator settings: ${error.message}`, "error");
  }
}
async function refreshAccounts() {
  const data = await api("/api/accounts");
  const accounts = data.accounts || [];
  if (accounts.length) setAccount(accounts[0]);
  else setAccount(null);
}
async function connectTikTok() {
  try {
    hideNotice();
    const data = await api("/api/connect");
    window.location.href = data.authUrl;
  } catch (error) {
    showNotice(error.message, "error");
  }
}
function clearVideo() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = null; state.previewUrl = null; state.publicUrl = null;
  $("videoInput").value = "";
  $("previewPlayer").removeAttribute("src");
  $("videoPreview").classList.add("hidden");
  $("uploadEmpty").classList.remove("hidden");
  updatePublishButton();
}
function acceptFile(file) {
  if (!file) return;
  const allowed = ["video/mp4", "video/quicktime", "video/webm"];
  const extOk = /\.(mp4|mov|webm)$/i.test(file.name);
  if (!(allowed.includes(file.type) || extOk)) return showNotice("Choose an MP4, MOV or WebM video.", "error");
  if (file.size > 4 * 1024 * 1024 * 1024) return showNotice("The maximum supported video size is 4 GB.", "error");
  clearVideo();
  state.file = file;
  state.previewUrl = URL.createObjectURL(file);
  $("previewPlayer").src = state.previewUrl;
  $("fileName").textContent = file.name;
  $("fileDetails").textContent = `${formatBytes(file.size)} · Reading video details...`;
  $("uploadEmpty").classList.add("hidden");
  $("videoPreview").classList.remove("hidden");
  $("previewPlayer").onloadedmetadata = () => {
    const video = $("previewPlayer");
    const duration = Number.isFinite(video.duration) ? `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, "0")}` : "Unknown duration";
    $("fileDetails").textContent = `${formatBytes(file.size)} · ${video.videoWidth}×${video.videoHeight} · ${duration}`;
    if (video.duration < 3 || video.duration > 600) showNotice("TikTok's documented video duration is 3 seconds to 10 minutes. Check this file before publishing.", "info");
  };
  hideNotice();
  updatePublishButton();
}
async function uploadAndPublish() {
  if (!canPublish()) return;
  setBusy(true);
  $("activityEmpty").classList.add("hidden");
  $("activityResult").classList.remove("hidden");
  $("activityResult").innerHTML = "<strong>Uploading video...</strong><p>Getting a secure upload link from Zernio.</p>";
  try {
    const mime = state.file.type || (state.file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : state.file.name.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4");
    const presign = await api("/api/media/presign", {
      method: "POST",
      body: JSON.stringify({ filename: state.file.name, contentType: mime, size: state.file.size })
    });
    $("activityResult").innerHTML = "<strong>Uploading video...</strong><p>Sending your video to secure Zernio media storage. Keep this page open.</p>";
    const put = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: state.file
    });
    if (!put.ok) throw new Error(`Video storage upload failed (${put.status}). Request a new upload link and try again.`);
    state.publicUrl = presign.publicUrl;
    $("activityResult").innerHTML = "<strong>Publishing to TikTok...</strong><p>Your video is uploaded. Zernio is now sending it to TikTok.</p>";
    const result = await api("/api/publish", {
      method: "POST",
      body: JSON.stringify({
        accountId: state.account.accountId,
        publicUrl: state.publicUrl,
        caption: $("caption").value,
        privacyLevel: $("privacySelect").value,
        allowComment: $("allowComment").checked,
        allowDuet: $("allowDuet").checked,
        allowStitch: $("allowStitch").checked,
        contentPreviewConfirmed: $("previewConsent").checked,
        expressConsentGiven: $("expressConsent").checked
      })
    });
    const post = result.post || {};
    const platform = post.platforms?.find(p => p.platform === "tiktok") || post.platforms?.[0];
    const status = platform?.status || post.status || "submitted";
    const url = platform?.platformPostUrl || platform?.url || "";
    $("activityResult").innerHTML = `<strong>Request submitted · ${escapeHtml(status)}</strong><p>Post ID: ${escapeHtml(post._id || post.id || "Returned by Zernio")}<br>${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">Open TikTok post ↗</a>` : "TikTok may take a little time to return the public video link."}</p>`;
    showNotice("Your video publishing request was accepted by Zernio. Check the activity panel for its status.", "success");
  } catch (error) {
    $("activityResult").innerHTML = `<strong>Publishing failed</strong><p>${escapeHtml(error.message)}</p>`;
    showNotice(error.message, "error");
  } finally {
    setBusy(false);
  }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function escapeAttr(value) { return escapeHtml(value); }

$("connectButton").addEventListener("click", connectTikTok);
$("connectButtonSecondary").addEventListener("click", connectTikTok);
$("browseButton").addEventListener("click", () => $("videoInput").click());
$("videoInput").addEventListener("change", event => acceptFile(event.target.files[0]));
$("removeVideo").addEventListener("click", clearVideo);
$("dropZone").addEventListener("dragover", event => { event.preventDefault(); $("dropZone").classList.add("dragging"); });
$("dropZone").addEventListener("dragleave", () => $("dropZone").classList.remove("dragging"));
$("dropZone").addEventListener("drop", event => {
  event.preventDefault(); $("dropZone").classList.remove("dragging");
  acceptFile(event.dataTransfer.files[0]);
});
$("caption").addEventListener("input", () => {
  $("captionCount").textContent = `${$("caption").value.length.toLocaleString()} / 2,200`;
  updatePublishButton();
});
$("hashtagButton").addEventListener("click", () => {
  const field = $("caption");
  const insert = " #fyp #edit #editors #preset5mb #xzybca";
  field.setRangeText(insert, field.selectionStart, field.selectionEnd, "end");
  field.dispatchEvent(new Event("input"));
  field.focus();
});
["privacySelect", "previewConsent", "expressConsent"].forEach(id => $(id).addEventListener("change", updatePublishButton));
$("publishButton").addEventListener("click", uploadAndPublish);

async function showWorkspace(profileName = "ZERNIO PROFILE") {
  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("profileLabel").textContent = String(profileName).toUpperCase();
  $("apiDot").classList.add("ready");
  $("apiStatus").textContent = "Zernio connected";
  await refreshAccounts();
}

async function loginWithKey(event) {
  event.preventDefault();
  const key = $("apiKeyInput").value.trim();
  if (!key) return;
  const button = $("loginButton");
  const errorBox = $("loginError");
  button.disabled = true;
  button.querySelector("span:first-child").textContent = "Verifying key...";
  errorBox.classList.add("hidden");
  try {
    const result = await api("/api/login", { method: "POST", body: JSON.stringify({ apiKey: key }) });
    $("apiKeyInput").value = "";
    await showWorkspace(result.profileName || "Zernio profile");
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.querySelector("span:first-child").textContent = "Login";
  }
}

async function logout() {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  state.account = null;
  state.creatorInfo = null;
  clearVideo();
  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  $("apiKeyInput").value = "";
  $("loginError").classList.add("hidden");
}

async function init() {
  $("loginForm").addEventListener("submit", loginWithKey);
  $("toggleKey").addEventListener("click", () => {
    const input = $("apiKeyInput");
    input.type = input.type === "password" ? "text" : "password";
    $("toggleKey").textContent = input.type === "password" ? "SHOW" : "HIDE";
  });
  $("logoutButton").addEventListener("click", logout);
  const params = new URLSearchParams(location.search);
  if (params.get("connected") === "tiktok") {
    showNotice(`TikTok account ${params.get("username") ? "@" + params.get("username") + " " : ""}connected successfully.`, "success");
    history.replaceState({}, "", "/");
  } else if (params.get("error")) {
    showNotice(params.get("error_description") || params.get("error"), "error");
    history.replaceState({}, "", "/");
  }
  try {
    const health = await api("/api/health");
    if (health.authenticated) await showWorkspace(health.profileName || "Zernio profile");
    else {
      $("loginScreen").classList.remove("hidden");
      $("appShell").classList.add("hidden");
    }
  } catch (error) {
    $("loginError").textContent = error.message;
    $("loginError").classList.remove("hidden");
  }
}
init();
