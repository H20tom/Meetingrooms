'use strict';

// Endpoints rond gebruikers/sessies/invites/resets/pins — spiegelt window.Auth uit auth.js.
// Verschil met de frontend: tokens worden hier server-side opgeslagen (DB) i.p.v.
// in self-contained base64-payloads. bcrypt vervangt de client-side SHA-256.

const express = require('express');
const { pool } = require('../db');
const {
  COOKIE_NAME,
  SESSION_TTL_DAYS,
  nowUtc,
  utcPlusDays,
  randomToken,
  hashPassword,
  verifyPassword,
  sanitizeUser,
  createSession,
  destroySession,
  requireAuth,
  requireAdmin,
} = require('../lib/auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const INVITE_TTL_DAYS = 7;
const RESET_TTL_HOURS = 24;
const PIN_SETUP_TTL_DAYS = 7;

// ---------- helpers ----------
function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
function normEmail(s) {
  return String(s || '').trim().toLowerCase();
}
function newUserId() {
  return 'u-' + randomToken(6);
}
function utcPlusHours(h) {
  return new Date(Date.now() + h * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}
function digitCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
    maxAge: SESSION_TTL_DAYS * 86400000,
    path: '/',
  };
}

async function findUserByEmail(email) {
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1',
    [normEmail(email)],
  );
  return rows.length ? rows[0] : null;
}
async function findUserById(id) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows.length ? rows[0] : null;
}

// ============================================================
//  Auth: login / logout / me
// ============================================================
router.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await findUserByEmail(email);
  if (!user) return res.json({ ok: false, reason: 'unknown-user' });
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return res.json({ ok: false, reason: 'bad-password' });
  const token = await createSession(user.id);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true, user: sanitizeUser(user) });
}));

router.post('/auth/logout', wrap(async (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  await destroySession(token);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
}));

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: sanitizeUser(req.user) });
});

// ============================================================
//  Gebruikersbeheer
// ============================================================
router.get('/users', requireAuth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
  res.json({ ok: true, data: rows.map(sanitizeUser) });
}));

// Lichtgewicht lijst voor de tablet-quickpick (geen auth — alleen niet-gevoelige velden).
router.get('/users/quickpick', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, email, role, pin_hash FROM users ORDER BY name ASC');
  res.json({
    ok: true,
    data: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, hasPin: !!u.pin_hash })),
  });
}));

router.post('/users', requireAdmin, wrap(async (req, res) => {
  const { email, name, role, password } = req.body || {};
  if (!email || !name || !password) return res.json({ ok: false, reason: 'missing-fields' });
  if (!isValidEmail(email)) return res.json({ ok: false, reason: 'invalid-email' });
  if (await findUserByEmail(email)) return res.json({ ok: false, reason: 'duplicate-email' });
  const id = newUserId();
  const hash = await hashPassword(password);
  await pool.execute(
    'INSERT INTO users (id, email, name, role, password_hash, created_at, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, String(email).trim(), String(name).trim(), role === 'admin' ? 'admin' : 'user', hash, nowUtc(), req.user.email],
  );
  res.json({ ok: true, user: sanitizeUser(await findUserById(id)) });
}));

router.patch('/users/:id', requireAdmin, wrap(async (req, res) => {
  const target = await findUserById(req.params.id);
  if (!target) return res.json({ ok: false, reason: 'not-found' });
  const patch = req.body || {};
  const sets = [];
  const params = [];
  if (patch.name) { sets.push('name = ?'); params.push(String(patch.name).trim()); }
  if (patch.email) {
    if (!isValidEmail(patch.email)) return res.json({ ok: false, reason: 'invalid-email' });
    const dup = await findUserByEmail(patch.email);
    if (dup && dup.id !== target.id) return res.json({ ok: false, reason: 'duplicate-email' });
    sets.push('email = ?'); params.push(String(patch.email).trim());
  }
  if (patch.role === 'admin' || patch.role === 'user') { sets.push('role = ?'); params.push(patch.role); }
  if (patch.password) { sets.push('password_hash = ?'); params.push(await hashPassword(patch.password)); }
  if (!sets.length) return res.json({ ok: true, user: sanitizeUser(target) });
  params.push(target.id);
  await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true, user: sanitizeUser(await findUserById(target.id)) });
}));

router.delete('/users/:id', requireAdmin, wrap(async (req, res) => {
  if (req.user.id === req.params.id) return res.json({ ok: false, reason: 'cannot-remove-self' });
  const target = await findUserById(req.params.id);
  if (!target) return res.json({ ok: false, reason: 'not-found' });
  // Bescherm de laatste admin.
  if (target.role === 'admin') {
    const [[{ cnt }]] = await pool.query("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'");
    if (cnt <= 1) return res.json({ ok: false, reason: 'last-admin' });
  }
  await pool.execute('DELETE FROM users WHERE id = ?', [target.id]);
  res.json({ ok: true });
}));

// ============================================================
//  PIN (snelle meeting-auth op de tablet)
// ============================================================
function isValidPin(pin) {
  return /^\d{4,6}$/.test(String(pin || ''));
}

// Admin mag elke PIN zetten; een gebruiker mag z'n eigen PIN zetten.
router.post('/users/:id/pin', requireAuth, wrap(async (req, res) => {
  const targetId = req.params.id;
  if (req.user.role !== 'admin' && req.user.id !== targetId) {
    return res.json({ ok: false, reason: 'forbidden' });
  }
  if (!isValidPin((req.body || {}).pin)) return res.json({ ok: false, reason: 'invalid-pin' });
  const target = await findUserById(targetId);
  if (!target) return res.json({ ok: false, reason: 'not-found' });
  const pinHash = await hashPassword(String(req.body.pin));
  await pool.execute('UPDATE users SET pin_hash = ? WHERE id = ?', [pinHash, targetId]);
  res.json({ ok: true });
}));

router.delete('/users/:id/pin', requireAdmin, wrap(async (req, res) => {
  const target = await findUserById(req.params.id);
  if (!target) return res.json({ ok: false, reason: 'not-found' });
  await pool.execute('UPDATE users SET pin_hash = NULL WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// Verifieer een PIN (publiek — tablet kent geen sessie).
router.post('/users/pin/verify', wrap(async (req, res) => {
  const { idOrEmail, pin } = req.body || {};
  const key = String(idOrEmail || '');
  let user = await findUserById(key);
  if (!user) user = await findUserByEmail(key);
  if (!user || !user.pin_hash) return res.json({ ok: false, reason: 'no-pin' });
  const valid = await verifyPassword(pin, user.pin_hash);
  if (!valid) return res.json({ ok: false, reason: 'bad-pin' });
  res.json({ ok: true, user: sanitizeUser(user) });
}));

// ============================================================
//  Uitnodigingen
// ============================================================
function serializeInvite(i) {
  return {
    token: i.token,
    email: i.email,
    name: i.name,
    role: i.role,
    invitedBy: i.invited_by || null,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
  };
}

router.post('/invites', requireAdmin, wrap(async (req, res) => {
  const { email, name, role } = req.body || {};
  if (!email || !name) return res.json({ ok: false, reason: 'missing-fields' });
  if (!isValidEmail(email)) return res.json({ ok: false, reason: 'invalid-email' });
  if (await findUserByEmail(email)) return res.json({ ok: false, reason: 'duplicate-email' });
  // Vervang een bestaande invite voor hetzelfde e-mailadres.
  await pool.execute('DELETE FROM invites WHERE LOWER(email) = ?', [normEmail(email)]);
  const token = randomToken(24);
  await pool.execute(
    'INSERT INTO invites (token, email, name, role, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [token, String(email).trim(), String(name).trim(), role === 'admin' ? 'admin' : 'user', req.user.email, nowUtc(), utcPlusDays(INVITE_TTL_DAYS)],
  );
  const [rows] = await pool.execute('SELECT * FROM invites WHERE token = ?', [token]);
  res.json({ ok: true, invite: serializeInvite(rows[0]) });
}));

router.get('/invites', requireAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM invites WHERE expires_at <= UTC_TIMESTAMP()');
  const [rows] = await pool.query('SELECT * FROM invites ORDER BY created_at DESC');
  res.json({ ok: true, data: rows.map(serializeInvite) });
}));

router.get('/invites/:token', wrap(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT * FROM invites WHERE token = ? AND expires_at > UTC_TIMESTAMP() LIMIT 1',
    [req.params.token],
  );
  if (!rows.length) return res.json({ ok: false, reason: 'invalid-or-expired' });
  res.json({ ok: true, invite: serializeInvite(rows[0]) });
}));

router.post('/invites/:token/consume', wrap(async (req, res) => {
  const { password } = req.body || {};
  const [rows] = await pool.execute(
    'SELECT * FROM invites WHERE token = ? AND expires_at > UTC_TIMESTAMP() LIMIT 1',
    [req.params.token],
  );
  if (!rows.length) return res.json({ ok: false, reason: 'invalid-or-expired' });
  if (!password || String(password).length < 6) return res.json({ ok: false, reason: 'weak-password' });
  const inv = rows[0];
  if (await findUserByEmail(inv.email)) return res.json({ ok: false, reason: 'duplicate-email' });
  const id = newUserId();
  const hash = await hashPassword(password);
  await pool.execute(
    'INSERT INTO users (id, email, name, role, password_hash, created_at, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, inv.email, inv.name, inv.role, hash, nowUtc(), inv.invited_by],
  );
  await pool.execute('DELETE FROM invites WHERE token = ?', [inv.token]);
  // Auto-login.
  const token = await createSession(id);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true, user: sanitizeUser(await findUserById(id)) });
}));

router.delete('/invites/:token', requireAdmin, wrap(async (req, res) => {
  const [r] = await pool.execute('DELETE FROM invites WHERE token = ?', [req.params.token]);
  res.json({ ok: r.affectedRows > 0, reason: r.affectedRows > 0 ? undefined : 'not-found' });
}));

// ============================================================
//  Wachtwoord-resets
// ============================================================
router.post('/auth/reset/request', wrap(async (req, res) => {
  const user = await findUserByEmail((req.body || {}).email);
  if (!user) return res.json({ ok: false, reason: 'unknown-user' });
  const token = digitCode(6);
  // Eén actieve reset per gebruiker.
  await pool.execute('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
  await pool.execute(
    'INSERT INTO password_resets (user_id, email, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [user.id, user.email, token, utcPlusHours(RESET_TTL_HOURS), nowUtc()],
  );
  res.json({ ok: true, token, user: sanitizeUser(user) });
}));

router.post('/auth/reset/consume', wrap(async (req, res) => {
  const { email, token, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) return res.json({ ok: false, reason: 'weak-password' });
  const [rows] = await pool.execute(
    'SELECT * FROM password_resets WHERE LOWER(email) = ? AND token = ? LIMIT 1',
    [normEmail(email), String(token || '').trim()],
  );
  if (!rows.length) return res.json({ ok: false, reason: 'invalid-token' });
  const reset = rows[0];
  if (new Date(reset.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
    return res.json({ ok: false, reason: 'expired' });
  }
  const hash = await hashPassword(newPassword);
  await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, reset.user_id]);
  await pool.execute('DELETE FROM password_resets WHERE user_id = ?', [reset.user_id]);
  res.json({ ok: true });
}));

// ============================================================
//  PIN-setup links (admin maakt link, gebruiker kiest PIN)
// ============================================================
router.post('/users/:id/pin-setup', requireAdmin, wrap(async (req, res) => {
  const user = await findUserById(req.params.id);
  if (!user) return res.json({ ok: false, reason: 'not-found' });
  const token = randomToken(24);
  await pool.execute('DELETE FROM pin_setups WHERE user_id = ?', [user.id]);
  await pool.execute(
    'INSERT INTO pin_setups (token, user_id, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [token, user.id, user.email, utcPlusDays(PIN_SETUP_TTL_DAYS), nowUtc()],
  );
  res.json({ ok: true, token, user: sanitizeUser(user), expiresAt: utcPlusDays(PIN_SETUP_TTL_DAYS) });
}));

router.post('/pin-setup/:token/consume', wrap(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT * FROM pin_setups WHERE token = ? AND expires_at > UTC_TIMESTAMP() LIMIT 1',
    [req.params.token],
  );
  if (!rows.length) return res.json({ ok: false, reason: 'invalid-or-expired' });
  if (!isValidPin((req.body || {}).pin)) return res.json({ ok: false, reason: 'invalid-pin' });
  const setup = rows[0];
  const pinHash = await hashPassword(String(req.body.pin));
  await pool.execute('UPDATE users SET pin_hash = ? WHERE id = ?', [pinHash, setup.user_id]);
  await pool.execute('DELETE FROM pin_setups WHERE user_id = ?', [setup.user_id]);
  res.json({ ok: true, user: sanitizeUser(await findUserById(setup.user_id)) });
}));

module.exports = router;
