/* ============================================================
   H20 Meetingroom — Auth & User Management (async REST)
   Praat met de Node/Express + MySQL backend via /api/...
   bcrypt + DB-tokens server-side; httpOnly-cookie sessie.
   window.Auth blijft dezelfde methodenamen houden, maar alles is async.
   ============================================================ */

const ADMIN_EMAIL = 'tom@h20.gg';
const SESSION_TTL_DAYS = 7;

// ---------- API helper (deelt vorm met H20.apiFetch) ----------
async function api(path, opts = {}) {
  if (window.H20 && typeof window.H20.apiFetch === 'function') {
    return window.H20.apiFetch(path, opts);
  }
  const init = { method: opts.method || 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  try {
    const res = await fetch(`/api${path}`, init);
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (json == null) return { ok: false, reason: 'http-' + res.status, status: res.status };
    if (json.status === undefined) json.status = res.status;
    return json;
  } catch { return { ok: false, reason: 'network' }; }
}

function baseUrl() {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

// ---------- seed ----------
// Server seedt via scripts/migrate.js; client hoeft niets te doen.
async function ensureSeed() { return []; }

// ---------- sessie ----------
async function login(email, password) {
  return api('/auth/login', { method: 'POST', body: { email, password } });
}

async function logout() {
  return api('/auth/logout', { method: 'POST' });
}

async function getCurrentUser() {
  const r = await api('/auth/me');
  return r && r.ok && r.user ? r.user : null;
}

async function isAdmin() {
  const u = await getCurrentUser();
  if (!u) return false;
  if (u.role === 'admin') return true;
  return !!(u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
}

// ---------- gebruikersbeheer ----------
async function listUsers() {
  const r = await api('/users');
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function addUser({ email, name, role, password }) {
  return api('/users', { method: 'POST', body: { email, name, role, password } });
}

async function updateUser(id, patch) {
  return api(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

async function removeUser(id) {
  return api(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------- PIN ----------
async function setUserPin(id, pin) {
  return api(`/users/${encodeURIComponent(id)}/pin`, { method: 'POST', body: { pin } });
}

async function clearUserPin(id) {
  return api(`/users/${encodeURIComponent(id)}/pin`, { method: 'DELETE' });
}

async function verifyUserPin(idOrEmail, pin) {
  return api('/users/pin/verify', { method: 'POST', body: { idOrEmail, pin } });
}

async function listUsersForQuickPick() {
  const r = await api('/users/quickpick');
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

// ---------- wachtwoord-reset ----------
async function requestPasswordReset(email) {
  const r = await api('/auth/reset/request', { method: 'POST', body: { email } });
  if (!r.ok) return r;
  const link = `${baseUrl()}login.html?reset=${encodeURIComponent(r.token)}&email=${encodeURIComponent(r.user.email)}`;
  return { ok: true, token: r.token, link, user: r.user };
}

async function resetPasswordWithToken(email, token, newPassword) {
  return api('/auth/reset/consume', { method: 'POST', body: { email, token, newPassword } });
}

// Geen server-endpoint om openstaande resets te lijsten (transient).
async function listPendingResets() { return []; }

// ---------- uitnodigingen ----------
async function createInvite({ email, name, role }) {
  const r = await api('/invites', { method: 'POST', body: { email, name, role } });
  if (!r.ok) return r;
  const link = `${baseUrl()}login.html?invite=${encodeURIComponent(r.invite.token)}`;
  return { ok: true, invite: r.invite, link };
}

async function getInvite(token) {
  if (!token) return null;
  const r = await api(`/invites/${encodeURIComponent(token)}`);
  return r.ok && r.invite ? r.invite : null;
}

async function consumeInvite(token, password) {
  return api(`/invites/${encodeURIComponent(token)}/consume`, { method: 'POST', body: { password } });
}

async function listInvites() {
  const r = await api('/invites');
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function revokeInvite(token) {
  return api(`/invites/${encodeURIComponent(token)}`, { method: 'DELETE' });
}

function buildInviteMailto(invite, link) {
  const subject = `Uitnodiging: Meetingrooms H20 (${invite.role === 'admin' ? 'admin' : 'gebruiker'})`;
  const body =
`Hoi ${invite.name},

Je bent uitgenodigd voor het Meetingrooms H20 dashboard.

Open onderstaande link en kies een eigen wachtwoord:
${link}

Deze uitnodiging is 7 dagen geldig.

Groet,
H20 Esports Campus`;
  return `mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---------- PIN-setup links ----------
async function createPinSetupLink(userId) {
  const r = await api(`/users/${encodeURIComponent(userId)}/pin-setup`, { method: 'POST' });
  if (!r.ok) return r;
  const link = `${baseUrl()}login.html?setpin=${encodeURIComponent(r.token)}`;
  return { ok: true, link, user: r.user, expiresAt: r.expiresAt };
}

async function consumePinSetup(token, pin) {
  return api(`/pin-setup/${encodeURIComponent(token)}/consume`, { method: 'POST', body: { pin } });
}

// ---------- page guards ----------
async function requireLogin(redirectTo = 'login.html') {
  const u = await getCurrentUser();
  if (!u) {
    // Behoud bestand + query (bijv. tablet.html?room=aquarium) zodat we na
    // inloggen exact terugkeren naar de gevraagde pagina.
    const file = location.pathname.split('/').pop() || 'dashboard.html';
    const cur = encodeURIComponent(file + location.search);
    location.replace(`${redirectTo}?next=${cur}`);
    return null;
  }
  return u;
}

async function requireAdmin(redirectTo = 'dashboard.html') {
  const u = await requireLogin();
  if (!u) return null;
  if (u.role !== 'admin') { location.replace(redirectTo); return null; }
  return u;
}

window.Auth = {
  ADMIN_EMAIL, SESSION_TTL_DAYS,
  ensureSeed,
  login, logout,
  getCurrentUser, isAdmin,
  listUsers, addUser, updateUser, removeUser,
  setUserPin, clearUserPin, verifyUserPin, listUsersForQuickPick,
  requestPasswordReset, resetPasswordWithToken, listPendingResets,
  createInvite, getInvite, consumeInvite, listInvites, revokeInvite, buildInviteMailto,
  createPinSetupLink, consumePinSetup,
  requireLogin, requireAdmin,
};
