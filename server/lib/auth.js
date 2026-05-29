'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const SESSION_TTL_DAYS = 7;
const COOKIE_NAME = 'h20_session';

function nowUtc() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
function utcPlusDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), 12);
}
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain), hash);
}

// Verwijder gevoelige velden voordat een user naar de client gaat.
function sanitizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.created_at,
    invitedBy: u.invited_by || null,
    hasPin: !!u.pin_hash,
  };
}

async function createSession(userId) {
  const token = randomToken(32);
  await pool.execute(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [token, userId, utcPlusDays(SESSION_TTL_DAYS), nowUtc()],
  );
  return token;
}

async function destroySession(token) {
  if (!token) return;
  await pool.execute('DELETE FROM sessions WHERE token = ?', [token]);
}

async function userFromToken(token) {
  if (!token) return null;
  const [rows] = await pool.execute(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [token],
  );
  return rows.length ? rows[0] : null;
}

// Express-middleware: zet req.user (raw row) of 401.
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    const user = await userFromToken(token);
    if (!user) return res.status(401).json({ ok: false, reason: 'not-authenticated' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ ok: false, reason: 'forbidden' });
    }
    next();
  });
}

module.exports = {
  SESSION_TTL_DAYS,
  COOKIE_NAME,
  nowUtc,
  utcPlusDays,
  randomToken,
  hashPassword,
  verifyPassword,
  sanitizeUser,
  createSession,
  destroySession,
  userFromToken,
  requireAuth,
  requireAdmin,
};
