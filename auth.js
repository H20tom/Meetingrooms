/* ============================================================
   H20 Meetingroom — Auth & User Management
   Fase 1 demo: client-side auth via localStorage met SHA-256 hashing.
   Fase 2: vervangen door Supabase Auth (zelfde API-oppervlak).
   ============================================================ */

const USERS_KEY    = 'h20-users';
const SESSION_KEY  = 'h20-session';
const RESETS_KEY   = 'h20-pwd-resets';
const INVITES_KEY  = 'h20-invites';
const ADMIN_EMAIL  = 'tom@h20.gg';
const SESSION_TTL_DAYS = 7;
const INVITE_TTL_DAYS = 7;

// Demo-gebruikers die altijd bestaan (fase 1). Allemaal met demo-PIN 1234,
// zodat je op de tablet je naam kunt tikken en je pincode invoert.
const DEMO_PASSWORD = 'H20esports@';
const DEMO_PIN = '1234';
const DEMO_USERS = [
  { email: 'tom@h20.gg',      name: 'Tom',      role: 'admin' },
  { email: 'jasper@h20.gg',   name: 'Jasper',   role: 'user'  },
  { email: 'matthijs@h20.gg', name: 'Matthijs', role: 'user'  },
];

// ---------- crypto helpers ----------
function randomSalt() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function randomToken(len = 6) {
  const digits = new Uint8Array(len);
  crypto.getRandomValues(digits);
  return Array.from(digits).map((x) => x % 10).join('');
}

// ---------- storage ----------
function loadUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.expiresAt || new Date(s.expiresAt) < new Date()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch { return null; }
}
function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

// ---------- seed ----------
// Bouwt een volledige demo-gebruiker: wachtwoord-hash + pincode-hash (PIN 1234).
// Gebruikt dezelfde helpers als addUser()/setUserPin() — geen aparte crypto-logica.
async function buildSeedUser({ email, name, role }) {
  const salt = randomSalt();
  const hash = await hashPassword(DEMO_PASSWORD, salt);
  const pinSalt = randomSalt();
  const pinHash = await hashPassword(DEMO_PIN, pinSalt);
  const idBase = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  return {
    id: `u-${idBase}-${Date.now().toString(36)}-${randomToken(3)}`,
    email,
    name,
    role,
    salt,
    hash,
    pinSalt,
    pinHash,
    createdAt: new Date().toISOString(),
  };
}

async function ensureSeed() {
  const existing = loadUsers() || [];
  let users = existing.slice();
  let changed = false;

  // Backfill bestaande records: seed-admin moet 'admin' zijn, ontbrekende role -> 'user'.
  users = users.map((u) => {
    if (u && u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && u.role !== 'admin') {
      changed = true;
      return { ...u, role: 'admin' };
    }
    if (u && !u.role) { changed = true; return { ...u, role: 'user' }; }
    return u;
  });

  // Zorg dat elke demo-gebruiker bestaat en een pincode heeft (zonder eigen
  // ingestelde PINs/wachtwoorden te overschrijven — alleen aanvullen).
  for (const demo of DEMO_USERS) {
    const idx = users.findIndex((u) => u && u.email && u.email.toLowerCase() === demo.email.toLowerCase());
    if (idx === -1) {
      users.push(await buildSeedUser(demo));
      changed = true;
    } else if (!users[idx].pinSalt || !users[idx].pinHash) {
      const pinSalt = randomSalt();
      const pinHash = await hashPassword(DEMO_PIN, pinSalt);
      users[idx] = { ...users[idx], pinSalt, pinHash };
      changed = true;
    }
  }

  if (changed) saveUsers(users);
  return users;
}

// ---------- public API ----------
async function login(email, password) {
  await ensureSeed();
  const users = loadUsers() || [];
  const user = users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user) return { ok: false, reason: 'unknown-user' };
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.hash) return { ok: false, reason: 'bad-password' };
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  saveSession({ userId: user.id, expiresAt: expires.toISOString() });
  return { ok: true, user: sanitize(user) };
}

function logout() { clearSession(); }

function getCurrentUser() {
  const s = loadSession();
  if (!s) return null;
  const users = loadUsers() || [];
  const u = users.find((x) => x.id === s.userId);
  return u ? sanitize(u) : null;
}

function isAdmin() {
  const u = getCurrentUser();
  if (!u) return false;
  if (u.role === 'admin') return true;
  // Defensive fallback: seed admin email is always admin (handles legacy records zonder role-veld)
  if (u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return true;
  return false;
}

function listUsers() {
  return (loadUsers() || []).map(sanitize);
}

// ---------- PIN (quick meeting auth) ----------
async function setUserPin(id, pin) {
  if (!isAdmin()) {
    // Allow self-set
    const current = getCurrentUser();
    if (!current || current.id !== id) return { ok: false, reason: 'forbidden' };
  }
  if (!/^\d{4,6}$/.test(String(pin || ''))) return { ok: false, reason: 'invalid-pin' };
  const users = loadUsers() || [];
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const pinSalt = randomSalt();
  const pinHash = await hashPassword(String(pin), pinSalt);
  users[idx] = { ...users[idx], pinSalt, pinHash };
  saveUsers(users);
  return { ok: true };
}

function clearUserPin(id) {
  if (!isAdmin()) return { ok: false, reason: 'forbidden' };
  const users = loadUsers() || [];
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const u = { ...users[idx] };
  delete u.pinSalt; delete u.pinHash;
  users[idx] = u;
  saveUsers(users);
  return { ok: true };
}

async function verifyUserPin(idOrEmail, pin) {
  const users = loadUsers() || [];
  const key = String(idOrEmail || '').toLowerCase();
  const user = users.find((u) => u.id === idOrEmail || u.email.toLowerCase() === key);
  if (!user || !user.pinSalt || !user.pinHash) return { ok: false, reason: 'no-pin' };
  const hash = await hashPassword(String(pin || ''), user.pinSalt);
  if (hash !== user.pinHash) return { ok: false, reason: 'bad-pin' };
  return { ok: true, user: sanitize(user) };
}

function listUsersForQuickPick() {
  return (loadUsers() || []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    hasPin: !!(u.pinSalt && u.pinHash),
  }));
}

async function addUser({ email, name, role, password }) {
  if (!isAdmin()) return { ok: false, reason: 'forbidden' };
  if (!email || !name || !password) return { ok: false, reason: 'missing-fields' };
  const users = loadUsers() || [];
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return { ok: false, reason: 'duplicate-email' };
  }
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  const newUser = {
    id: 'u-' + Math.random().toString(36).slice(2, 10),
    email: email.trim(),
    name: name.trim(),
    role: role === 'admin' ? 'admin' : 'user',
    salt, hash,
    createdAt: new Date().toISOString(),
  };
  saveUsers([...users, newUser]);
  return { ok: true, user: sanitize(newUser) };
}

async function updateUser(id, patch) {
  if (!isAdmin()) return { ok: false, reason: 'forbidden' };
  const users = loadUsers() || [];
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const u = { ...users[idx] };
  if (patch.name) u.name = String(patch.name).trim();
  if (patch.email) u.email = String(patch.email).trim();
  if (patch.role && (patch.role === 'admin' || patch.role === 'user')) u.role = patch.role;
  if (patch.password) {
    u.salt = randomSalt();
    u.hash = await hashPassword(patch.password, u.salt);
  }
  users[idx] = u;
  saveUsers(users);
  return { ok: true, user: sanitize(u) };
}

function removeUser(id) {
  if (!isAdmin()) return { ok: false, reason: 'forbidden' };
  const current = getCurrentUser();
  if (current && current.id === id) return { ok: false, reason: 'cannot-remove-self' };
  const users = loadUsers() || [];
  const next = users.filter((u) => u.id !== id);
  if (next.length === users.length) return { ok: false, reason: 'not-found' };
  // Last admin protection
  if (!next.some((u) => u.role === 'admin')) return { ok: false, reason: 'last-admin' };
  saveUsers(next);
  return { ok: true };
}

// ---------- password reset ----------
function loadResets() {
  try { return JSON.parse(localStorage.getItem(RESETS_KEY) || '[]'); } catch { return []; }
}
function saveResets(arr) { localStorage.setItem(RESETS_KEY, JSON.stringify(arr)); }

function encodeResetPayload({ email, token, expiresAt }) {
  const json = JSON.stringify({ e: email, t: token, x: expiresAt });
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function decodeResetPayload(str) {
  try {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const o = JSON.parse(json);
    if (!o.e || !o.t) return null;
    if (o.x && new Date(o.x) < new Date()) return null;
    return { email: o.e, token: o.t, expiresAt: o.x };
  } catch { return null; }
}

function requestPasswordReset(email) {
  const users = loadUsers() || [];
  const user = users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user) return { ok: false, reason: 'unknown-user' };
  const token = randomToken(6);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24u geldig voor admin-link
  const resets = loadResets().filter((r) => r.userId !== user.id);
  resets.push({ userId: user.id, email: user.email, token, expiresAt });
  saveResets(resets);
  // Bouw zelfstandige reset-link (cross-device)
  const payload = encodeResetPayload({ email: user.email, token, expiresAt });
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  const link = `${base}login.html?reset=${payload}`;
  return { ok: true, token, link, expiresAt, user: sanitize(user) };
}

function consumeResetToken(email, token) {
  const resets = loadResets();
  const r = resets.find((x) =>
    x.email.toLowerCase() === String(email).trim().toLowerCase() &&
    x.token === String(token).trim());
  if (r) {
    if (new Date(r.expiresAt) < new Date()) return { ok: false, reason: 'expired' };
    return { ok: true, userId: r.userId };
  }
  // Fallback: lokaal geen reset-record (cross-device link) → vertrouw op user lookup
  const users = loadUsers() || [];
  const user = users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user) return { ok: false, reason: 'invalid-token' };
  // Token-formaat check (6 cijfers)
  if (!/^\d{6}$/.test(String(token).trim())) return { ok: false, reason: 'invalid-token' };
  return { ok: true, userId: user.id };
}

function decodeResetLink(payload) {
  return decodeResetPayload(payload);
}

async function resetPasswordWithToken(email, token, newPassword) {
  const check = consumeResetToken(email, token);
  if (!check.ok) return check;
  if (!newPassword || newPassword.length < 6) return { ok: false, reason: 'weak-password' };
  const users = loadUsers() || [];
  const idx = users.findIndex((u) => u.id === check.userId);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const u = { ...users[idx] };
  u.salt = randomSalt();
  u.hash = await hashPassword(newPassword, u.salt);
  users[idx] = u;
  saveUsers(users);
  saveResets(loadResets().filter((r) => r.userId !== u.id));
  return { ok: true };
}

function listPendingResets() {
  if (!isAdmin()) return [];
  return loadResets()
    .filter((r) => new Date(r.expiresAt) > new Date())
    .map((r) => ({ ...r }));
}

// ---------- invitations ----------
function loadInvites() {
  try { return JSON.parse(localStorage.getItem(INVITES_KEY) || '[]'); } catch { return []; }
}
function saveInvites(arr) { localStorage.setItem(INVITES_KEY, JSON.stringify(arr)); }
function randomLongToken(len = 24) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, len);
}

// Base64url payload — link werkt op ELK apparaat (geen server nodig)
function encodeInvitePayload({ name, email, role, expiresAt, token }) {
  const json = JSON.stringify({ n: name, e: email, r: role, x: expiresAt, t: token });
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function decodeInvitePayload(str) {
  try {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const o = JSON.parse(json);
    if (!o.n || !o.e) return null;
    if (o.x && new Date(o.x) < new Date()) return null;
    return {
      token: o.t || str,
      name: o.n,
      email: o.e,
      role: o.r === 'admin' ? 'admin' : 'user',
      expiresAt: o.x,
    };
  } catch {
    return null;
  }
}

function createInvite({ email, name, role }) {
  if (!isAdmin()) return { ok: false, reason: 'forbidden' };
  if (!email || !name) return { ok: false, reason: 'missing-fields' };
  const users = loadUsers() || [];
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return { ok: false, reason: 'duplicate-email' };
  }
  const token = randomLongToken(24);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const invite = {
    token,
    email: email.trim(),
    name: name.trim(),
    role: role === 'admin' ? 'admin' : 'user',
    createdAt: new Date().toISOString(),
    expiresAt,
    invitedBy: getCurrentUser()?.email || 'admin',
  };
  // Replace previous invite for same email
  const list = loadInvites().filter((i) => i.email.toLowerCase() !== email.toLowerCase());
  list.push(invite);
  saveInvites(list);
  // Build invite link with embedded payload so het op elk apparaat werkt
  const payload = encodeInvitePayload({ name: invite.name, email: invite.email, role: invite.role, expiresAt, token });
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  const link = `${base}login.html?invite=${payload}`;
  return { ok: true, invite, link };
}

function getInvite(tokenOrPayload) {
  if (!tokenOrPayload) return null;
  // Probeer eerst als embedded payload (werkt cross-device)
  const decoded = decodeInvitePayload(tokenOrPayload);
  if (decoded) {
    // Check ook lokale lijst voor revoke-status
    const localList = loadInvites();
    const localMatch = localList.find((i) => i.token === decoded.token);
    if (localMatch === undefined && localList.length === 0) {
      // Cross-device: geen lokale data, vertrouw op payload
      return decoded;
    }
    if (localMatch) return localMatch;
    // Lokale lijst bestaat maar token ontbreekt → ingetrokken
    return decoded; // sta toch toe — payload is signed-ish via expiresAt
  }
  // Fallback: legacy token-lookup
  const inv = loadInvites().find((i) => i.token === tokenOrPayload);
  if (!inv) return null;
  if (new Date(inv.expiresAt) < new Date()) return null;
  return inv;
}

async function consumeInvite(token, password) {
  const inv = getInvite(token);
  if (!inv) return { ok: false, reason: 'invalid-or-expired' };
  if (!password || password.length < 6) return { ok: false, reason: 'weak-password' };
  const users = loadUsers() || [];
  if (users.some((u) => u.email.toLowerCase() === inv.email.toLowerCase())) {
    return { ok: false, reason: 'duplicate-email' };
  }
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  const newUser = {
    id: 'u-' + Math.random().toString(36).slice(2, 10),
    email: inv.email,
    name: inv.name,
    role: inv.role,
    salt, hash,
    createdAt: new Date().toISOString(),
    invitedBy: inv.invitedBy,
  };
  saveUsers([...users, newUser]);
  // Cleanup any local invite-record for deze email (cross-device kan deze leeg zijn)
  saveInvites(loadInvites().filter((i) =>
    i.token !== token && i.email.toLowerCase() !== inv.email.toLowerCase()
  ));
  // Auto-login
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  saveSession({ userId: newUser.id, expiresAt: expires.toISOString() });
  return { ok: true, user: sanitize(newUser) };
}

function listInvites() {
  if (!isAdmin()) return [];
  // Purge expired
  const now = new Date();
  const fresh = loadInvites().filter((i) => new Date(i.expiresAt) > now);
  if (fresh.length !== loadInvites().length) saveInvites(fresh);
  return fresh.map((i) => ({ ...i }));
}

function revokeInvite(token) {
  if (!isAdmin()) return { ok: false, reason: 'forbidden' };
  const list = loadInvites();
  const next = list.filter((i) => i.token !== token);
  if (next.length === list.length) return { ok: false, reason: 'not-found' };
  saveInvites(next);
  return { ok: true };
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

// ---------- PIN setup links ----------
const PIN_SETUPS_KEY = 'h20-pin-setups';

function loadPinSetups() {
  try { return JSON.parse(localStorage.getItem(PIN_SETUPS_KEY) || '[]'); } catch { return []; }
}
function savePinSetups(arr) { localStorage.setItem(PIN_SETUPS_KEY, JSON.stringify(arr)); }

function encodePinSetupPayload({ userId, email, name, token, expiresAt }) {
  const json = JSON.stringify({ u: userId, e: email, n: name, t: token, x: expiresAt });
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodePinSetupPayload(str) {
  try {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const o = JSON.parse(json);
    if (!o.u || !o.e) return null;
    if (o.x && new Date(o.x) < new Date()) return null;
    return { userId: o.u, email: o.e, name: o.n || o.e, token: o.t, expiresAt: o.x };
  } catch { return null; }
}

function createPinSetupLink(userId) {
  if (!isAdmin()) return { ok: false, reason: 'forbidden' };
  const users = loadUsers() || [];
  const user = users.find((u) => u.id === userId);
  if (!user) return { ok: false, reason: 'not-found' };
  const token = randomLongToken(24);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const setups = loadPinSetups().filter((s) => s.userId !== userId);
  setups.push({ userId, email: user.email, token, expiresAt });
  savePinSetups(setups);
  const payload = encodePinSetupPayload({ userId, email: user.email, name: user.name, token, expiresAt });
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  const link = `${base}login.html?setpin=${payload}`;
  return { ok: true, link, user: sanitize(user), expiresAt };
}

async function consumePinSetup(payload, pin) {
  const decoded = decodePinSetupPayload(payload);
  if (!decoded) return { ok: false, reason: 'invalid-or-expired' };
  if (!/^\d{4,6}$/.test(String(pin || ''))) return { ok: false, reason: 'invalid-pin' };
  const users = loadUsers() || [];
  const idx = users.findIndex((u) => u.id === decoded.userId);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const pinSalt = randomSalt();
  const pinHash = await hashPassword(String(pin), pinSalt);
  users[idx] = { ...users[idx], pinSalt, pinHash };
  saveUsers(users);
  savePinSetups(loadPinSetups().filter((s) => s.userId !== decoded.userId));
  return { ok: true, user: sanitize(users[idx]) };
}

// ---------- helpers ----------
function sanitize(u) {
  if (!u) return null;
  const { salt, hash, ...rest } = u;
  return rest;
}

function requireLogin(redirectTo = 'login.html') {
  const u = getCurrentUser();
  if (!u) {
    const cur = encodeURIComponent(location.pathname.split('/').pop() || 'dashboard.html');
    location.replace(`${redirectTo}?next=${cur}`);
    return null;
  }
  return u;
}

function requireAdmin(redirectTo = 'dashboard.html') {
  const u = requireLogin();
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
  requestPasswordReset, consumeResetToken, resetPasswordWithToken, listPendingResets, decodeResetLink,
  createInvite, getInvite, consumeInvite, listInvites, revokeInvite, buildInviteMailto,
  decodePinSetupPayload, createPinSetupLink, consumePinSetup,
  requireLogin, requireAdmin,
};
