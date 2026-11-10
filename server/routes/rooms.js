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

const MAX_TITLE_LEN = 120;

// Een vergadering duurt nooit langer dan een etmaal. Zonder bovengrens werd
// durationMin: 99999999 klakkeloos geaccepteerd en stond de ruimte tot het
// jaar 2216 op bezet — alleen nog met de hand uit de database te halen.
const MIN_DURATION_MIN = 5;
const MAX_DURATION_MIN = 24 * 60;
// Verder dan een jaar vooruit plannen is vrijwel altijd een typefout in het jaartal.
const MAX_SCHEDULE_AHEAD_DAYS = 366;

// Accepteert alleen een echt geheel getal binnen het bereik. `Number('30abc')`
// geeft NaN en `'30' >= 5` is true in JS — vandaar expliciet valideren.
function parseDuration(raw, { min = MIN_DURATION_MIN, max = MAX_DURATION_MIN } = {}) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

// Meeting-titels belanden op de tablet, het dashboard en in de export. De
// frontend escapet ze, maar dit is de tweede laag: geen hoeken, geen
// control-characters, begrensde lengte.
function cleanTitle(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, MAX_TITLE_LEN);
  return s || null;
}

// De tablet-quickpick geeft bewust geen e-mailadressen meer prijs (die lekten
// naar het open internet). In plaats daarvan stuurt de tablet een userId en
// zoekt de server het adres zelf op. Een meegestuurd e-mailadres wordt dan
// genegeerd, zodat je niet op naam van een ander kunt boeken.
async function resolveBooker({ userId, email, name }) {
  if (userId) {
    const [rows] = await pool.execute(
      'SELECT email, name FROM users WHERE id = ? LIMIT 1',
      [String(userId)],
    );
    if (!rows.length) return { ok: false, reason: 'unknown-user' };
    return { ok: true, email: rows[0].email, name: rows[0].name };
  }
  if (!isValidEmail(email)) return { ok: false, reason: 'invalid-email' };
  return {
    ok: true,
    email: email.trim(),
    name: name ? String(name).trim().slice(0, 120) : null,
  };
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

async function nextScheduledAfter(roomId, time, conn = pool) {
  const rows = await getScheduledRows(roomId, conn);
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
async function canStart(roomId, durationMin, now = new Date(), conn = pool) {
  const proposedEnd = new Date(now.getTime() + durationMin * 60000);
  const next = await nextScheduledAfter(roomId, now, conn);
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
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return { ok: false, reason: 'invalid-range', message: 'Ongeldige datum of tijd.' };
  }
  if (end <= start) return { ok: false, reason: 'invalid-range', message: 'Eindtijd moet na starttijd liggen.' };
  if ((end - start) / 60000 > MAX_DURATION_MIN) {
    return { ok: false, reason: 'too-long', message: 'Een reservering duurt maximaal 24 uur.' };
  }
  if (start.getTime() - Date.now() > MAX_SCHEDULE_AHEAD_DAYS * 86400000) {
    return { ok: false, reason: 'too-far-ahead', message: 'Niet verder dan een jaar vooruit plannen.' };
  }
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
  const { durationMin, title = null, email = null, name = null, userId = null, showTitleOnScreen = false } = req.body || {};
  const booker = await resolveBooker({ userId, email, name });
  if (!booker.ok) return res.json({ ok: false, reason: booker.reason });
  const minutes = parseDuration(durationMin);
  if (minutes === null) return res.json({ ok: false, reason: 'invalid-duration' });
  const safeTitle = cleanTitle(title);

  // De hele start loopt in één transactie met een rij-lock op de ruimte.
  // Zonder die lock konden twee gelijktijdige verzoeken allebei langs de
  // conflictcontrole komen en elkaars boeking overschrijven; in een test
  // slaagden 6 van de 8 parallelle starts en verdwenen 5 boekingen spoorloos.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [roomRows] = await conn.execute('SELECT id FROM rooms WHERE id = ? FOR UPDATE', [roomId]);
    if (!roomRows.length) {
      await conn.rollback();
      return res.json({ ok: false, reason: 'unknown-room' });
    }

    // Een bezette ruimte werd eerder stilzwijgend overschreven: de lopende
    // vergadering verdween uit active_meetings zonder ooit in meeting_history
    // te belanden. Nu weigeren we, en geeft de client de actuele status terug.
    const [activeRows] = await conn.execute(
      'SELECT * FROM active_meetings WHERE room_id = ? AND busy_until > UTC_TIMESTAMP()',
      [roomId],
    );
    if (activeRows.length) {
      await conn.rollback();
      const a = activeRows[0];
      return res.json({
        ok: false,
        reason: 'already-busy',
        busyUntil: fromDb(a.busy_until).toISOString(),
      });
    }

    const check = await canStart(roomId, minutes, new Date(), conn);
    if (!check.ok) {
      await conn.rollback();
      return res.json({ ok: false, ...check });
    }

    const now = new Date();
    const until = new Date(now.getTime() + minutes * 60000);
    await conn.execute('DELETE FROM active_meetings WHERE room_id = ?', [roomId]);
    await conn.execute(
      `INSERT INTO active_meetings
         (room_id, session_id, started_at, busy_until, title, email, name, show_title_on_screen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [roomId, uuid(), toDb(now), toDb(until), safeTitle, booker.email, booker.name, showTitleOnScreen && safeTitle ? 1 : 0],
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

router.post('/rooms/:id/extend', wrap(async (req, res) => {
  const roomId = req.params.id;
  const addMin = parseDuration((req.body || {}).addMin);
  if (addMin === null) return res.json({ ok: false, reason: 'invalid-duration' });
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
  const { startAt, endAt, title = null, email = null, name = null, userId = null, showTitleOnScreen = false } = req.body || {};
  const booker = await resolveBooker({ userId, email, name });
  if (!booker.ok) return res.json({ ok: false, reason: booker.reason });
  const safeTitle = cleanTitle(title);
  const check = await canSchedule(roomId, startAt, endAt);
  if (!check.ok) return res.json({ ok: false, ...check });
  const id = uuid();
  await pool.execute(
    `INSERT INTO scheduled_meetings
       (id, room_id, start_at, end_at, title, email, name, show_title_on_screen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, roomId, toDb(startAt), toDb(endAt), safeTitle, booker.email, booker.name, showTitleOnScreen && safeTitle ? 1 : 0, toDb(new Date())],
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
