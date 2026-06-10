'use strict';

// Endpoints rond ruimtes/meetings — spiegelt window.H20 uit app.js.
// Conflict-logica (canStart/canExtend/canSchedule) is 1-op-1 geporteerd.

const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin, requireHistoryViewer } = require('../lib/auth');

const router = express.Router();

// ---------- datum-helpers (MySQL DATETIME <-> JS Date, alles UTC) ----------
function toDb(d) {
  return new Date(d).toISOString().slice(0, 19).replace('T', ' ');
}
function fromDb(s) {
  // MySQL geeft 'YYYY-MM-DD HH:MM:SS' (UTC dankzij timezone:'Z' + dateStrings).
  return s ? new Date(s.replace(' ', 'T') + 'Z') : null;
}
function minutesBetween(a, b) {
  return Math.max(0, Math.round((b - a) / 60000));
}
function uuid() {
  return 'm-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// ---------- queries ----------
async function getActive(roomId) {
  const [rows] = await pool.execute('SELECT * FROM active_meetings WHERE room_id = ?', [roomId]);
  return rows.length ? rows[0] : null;
}

async function getScheduledRows(roomId, conn = pool) {
  // Lees-pad: muteer niets. Filter afgelopen items via WHERE i.p.v. een DELETE
  // (een GET hoort geen side-effects te hebben). Opruimen gebeurt apart.
  const [rows] = await conn.execute(
    'SELECT * FROM scheduled_meetings WHERE room_id = ? AND end_at > UTC_TIMESTAMP() ORDER BY start_at ASC',
    [roomId],
  );
  return rows;
}

async function nextScheduledAfter(roomId, time) {
  const rows = await getScheduledRows(roomId);
  const t = new Date(time);
  return rows.find((m) => fromDb(m.start_at) >= t) || null;
}

async function logHistory(roomId, active, endedAt, endReason) {
  if (!active) return;
  const start = fromDb(active.started_at);
  const end = new Date(endedAt);
  const durMin = Math.max(0, Math.round((end - start) / 60000));
  const [r] = await pool.execute('SELECT name FROM rooms WHERE id = ?', [roomId]);
  const roomName = r.length ? r[0].name : roomId;
  await pool.execute(
    `INSERT INTO meeting_history
       (session_id, room_id, room_name, email, name, title, started_at, ended_at, duration_min, end_reason, logged_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE session_id = session_id`,
    [
      active.session_id, roomId, roomName, active.email, active.name || null,
      active.title || null, toDb(start), toDb(end), durMin, endReason || 'ended', toDb(new Date()),
    ],
  );
}

// Promoot een geplande meeting naar 'active' als de starttijd bereikt is.
async function promoteIfDue(roomId) {
  const active = await getActive(roomId);
  const now = new Date();
  if (active && fromDb(active.busy_until) > now) return;
  const rows = await getScheduledRows(roomId);
  const due = rows.find((m) => fromDb(m.start_at) <= now && fromDb(m.end_at) > now);
  if (!due) return;
  await pool.execute('DELETE FROM active_meetings WHERE room_id = ?', [roomId]);
  await pool.execute(
    `INSERT INTO active_meetings
       (room_id, session_id, started_at, busy_until, title, email, name, show_title_on_screen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      roomId, uuid(), due.start_at, due.end_at, due.title || null,
      due.email, due.name || null, due.show_title_on_screen ? 1 : 0,
    ],
  );
  await pool.execute('DELETE FROM scheduled_meetings WHERE id = ?', [due.id]);
}

async function computeStatus(roomId) {
  await promoteIfDue(roomId);
  const active = await getActive(roomId);
  const now = new Date();
  if (!active) return { status: 'available' };
  const until = fromDb(active.busy_until);
  if (until <= now) {
    await logHistory(roomId, active, until, 'auto-expired');
    await pool.execute('DELETE FROM active_meetings WHERE room_id = ?', [roomId]);
    return { status: 'available' };
  }
  return {
    status: 'busy',
    busyUntil: until.toISOString(),
    startedAt: fromDb(active.started_at).toISOString(),
    minutesLeft: minutesBetween(now, until),
    title: active.title || null,
    email: active.email,
    name: active.name || null,
    showTitleOnScreen: !!active.show_title_on_screen,
  };
}

function serializeScheduled(rows) {
  return rows.map((m) => ({
    id: m.id,
    startAt: fromDb(m.start_at).toISOString(),
    endAt: fromDb(m.end_at).toISOString(),
    title: m.title || null,
    email: m.email,
    name: m.name || null,
    showTitleOnScreen: !!m.show_title_on_screen,
    createdAt: fromDb(m.created_at).toISOString(),
  }));
}

// ---------- conflict-checks (geporteerd uit app.js) ----------
async function canStart(roomId, durationMin, now = new Date()) {
  const proposedEnd = new Date(now.getTime() + durationMin * 60000);
  const next = await nextScheduledAfter(roomId, now);
  if (!next) return { ok: true, maxMinutes: null };
  const nextStart = fromDb(next.start_at);
  if (proposedEnd <= nextStart) return { ok: true, maxMinutes: minutesBetween(now, nextStart) };
  return { ok: false, maxMinutes: minutesBetween(now, nextStart), conflictWith: serializeScheduled([next])[0] };
}

async function canExtend(roomId, addMin) {
  const status = await computeStatus(roomId);
  if (status.status !== 'busy') return { ok: false, reason: 'not-busy' };
  const busyUntil = new Date(status.busyUntil);
  const proposedEnd = new Date(busyUntil.getTime() + addMin * 60000);
  const next = await nextScheduledAfter(roomId, busyUntil);
  if (!next) return { ok: true, maxMinutes: null };
  const nextStart = fromDb(next.start_at);
  if (proposedEnd <= nextStart) return { ok: true, maxMinutes: minutesBetween(busyUntil, nextStart) };
  return { ok: false, maxMinutes: minutesBetween(busyUntil, nextStart), conflictWith: serializeScheduled([next])[0] };
}

async function canSchedule(roomId, startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (end <= start) return { ok: false, reason: 'invalid-range', message: 'Eindtijd moet na starttijd liggen.' };
  if (start < new Date()) return { ok: false, reason: 'past', message: 'Starttijd ligt in het verleden.' };

  const active = await getActive(roomId);
  if (active) {
    const cs = fromDb(active.started_at);
    const ce = fromDb(active.busy_until);
    if (start < ce && end > cs) {
      return { ok: false, reason: 'overlap-current', conflictWith: { startAt: cs.toISOString(), endAt: ce.toISOString(), title: active.title || null } };
    }
  }
  const rows = await getScheduledRows(roomId);
  for (const m of rows) {
    const ms = fromDb(m.start_at);
    const me = fromDb(m.end_at);
    if (start < me && end > ms) {
      return { ok: false, reason: 'overlap-scheduled', conflictWith: serializeScheduled([m])[0] };
    }
  }
  return { ok: true };
}

// ---------- async error-wrapper ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- routes ----------
router.get('/rooms', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, subtitle FROM rooms ORDER BY sort_order ASC');
  res.json({ ok: true, data: rows });
}));

router.get('/rooms/:id/status', wrap(async (req, res) => {
  res.json({ ok: true, data: await computeStatus(req.params.id) });
}));

router.get('/rooms/:id/scheduled', wrap(async (req, res) => {
  const rows = await getScheduledRows(req.params.id);
  res.json({ ok: true, data: serializeScheduled(rows) });
}));

router.post('/rooms/:id/start', wrap(async (req, res) => {
  const roomId = req.params.id;
  const { durationMin, title = null, email = null, name = null, showTitleOnScreen = false } = req.body || {};
  if (!isValidEmail(email)) return res.json({ ok: false, reason: 'invalid-email' });
  if (!(durationMin >= 5)) return res.json({ ok: false, reason: 'invalid-duration' });
  const check = await canStart(roomId, durationMin);
  if (!check.ok) return res.json({ ok: false, ...check });
  const now = new Date();
  const until = new Date(now.getTime() + durationMin * 60000);
  await pool.execute('DELETE FROM active_meetings WHERE room_id = ?', [roomId]);
  await pool.execute(
    `INSERT INTO active_meetings
       (room_id, session_id, started_at, busy_until, title, email, name, show_title_on_screen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [roomId, uuid(), toDb(now), toDb(until), title, email.trim(), name ? String(name).trim() : null, showTitleOnScreen && title ? 1 : 0],
  );
  res.json({ ok: true });
}));

router.post('/rooms/:id/extend', wrap(async (req, res) => {
  const roomId = req.params.id;
  const addMin = Number((req.body || {}).addMin);
  const check = await canExtend(roomId, addMin);
  if (!check.ok) return res.json({ ok: false, ...check });
  const active = await getActive(roomId);
  if (!active) return res.json({ ok: false, reason: 'not-busy' });
  const newEnd = new Date(fromDb(active.busy_until).getTime() + addMin * 60000);
  await pool.execute('UPDATE active_meetings SET busy_until = ? WHERE room_id = ?', [toDb(newEnd), roomId]);
  res.json({ ok: true, newEnd: newEnd.toISOString() });
}));

router.post('/rooms/:id/end', wrap(async (req, res) => {
  const roomId = req.params.id;
  const active = await getActive(roomId);
  if (active) await logHistory(roomId, active, new Date(), 'ended-manually');
  await pool.execute('DELETE FROM active_meetings WHERE room_id = ?', [roomId]);
  res.json({ ok: true });
}));

router.post('/rooms/:id/schedule', wrap(async (req, res) => {
  const roomId = req.params.id;
  const { startAt, endAt, title = null, email = null, name = null, showTitleOnScreen = false } = req.body || {};
  if (!isValidEmail(email)) return res.json({ ok: false, reason: 'invalid-email' });
  const check = await canSchedule(roomId, startAt, endAt);
  if (!check.ok) return res.json({ ok: false, ...check });
  const id = uuid();
  await pool.execute(
    `INSERT INTO scheduled_meetings
       (id, room_id, start_at, end_at, title, email, name, show_title_on_screen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, roomId, toDb(startAt), toDb(endAt), title, email.trim(), name ? String(name).trim() : null, showTitleOnScreen && title ? 1 : 0, toDb(new Date())],
  );
  const [rows] = await pool.execute('SELECT * FROM scheduled_meetings WHERE id = ?', [id]);
  res.json({ ok: true, meeting: serializeScheduled(rows)[0] });
}));

router.delete('/rooms/:id/scheduled/:mid', wrap(async (req, res) => {
  const [r] = await pool.execute(
    'DELETE FROM scheduled_meetings WHERE id = ? AND room_id = ?',
    [req.params.mid, req.params.id],
  );
  res.json({ ok: r.affectedRows > 0 });
}));

// Historie bekijken/wissen — inzien mag voor admins én de H20-rol; wissen alleen admin.
router.get('/history', requireHistoryViewer, wrap(async (req, res) => {
  const { roomId = null, from = null, to = null } = req.query;
  const clauses = [];
  const params = [];
  if (roomId) { clauses.push('room_id = ?'); params.push(roomId); }
  if (from) { clauses.push('started_at >= ?'); params.push(toDb(from)); }
  if (to) { clauses.push('started_at <= ?'); params.push(toDb(to)); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const [rows] = await pool.execute(
    `SELECT * FROM meeting_history ${where} ORDER BY started_at DESC LIMIT 2000`,
    params,
  );
  const data = rows.map((r) => ({
    sessionId: r.session_id, roomId: r.room_id, roomName: r.room_name,
    email: r.email, name: r.name || null, title: r.title || '',
    startedAt: fromDb(r.started_at).toISOString(), endedAt: fromDb(r.ended_at).toISOString(),
    durationMin: r.duration_min, endReason: r.end_reason,
  }));
  res.json({ ok: true, data });
}));

router.delete('/history', requireAdmin, wrap(async (req, res) => {
  // Optionele filters; zonder filters wist dit alles (zoals voorheen).
  const { roomId = null, from = null, to = null } = req.query;
  const clauses = [];
  const params = [];
  if (roomId) { clauses.push('room_id = ?'); params.push(roomId); }
  if (from) { clauses.push('started_at >= ?'); params.push(toDb(from)); }
  if (to) { clauses.push('started_at <= ?'); params.push(toDb(to)); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const [r] = await pool.execute(`DELETE FROM meeting_history ${where}`, params);
  res.json({ ok: true, deleted: r.affectedRows });
}));

module.exports = router;
