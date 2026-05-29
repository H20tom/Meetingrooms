'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { ping } = require('./db');
const roomsRouter = require('./routes/rooms');
const authRouter = require('./routes/auth');

const app = express();
const PORT = Number(process.env.PORT || 4000);

const origins = (process.env.CORS_ORIGIN || 'http://localhost:8765')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({ origin: origins, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Healthcheck: bevestigt dat de DB-verbinding leeft.
app.get('/healthz', async (req, res) => {
  try {
    await ping();
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', reason: err.message });
  }
});

app.use('/api', roomsRouter);
app.use('/api', authRouter);

// 404
app.use((req, res) => res.status(404).json({ ok: false, reason: 'not-found' }));

// Centrale error-handler — lekt geen stacktraces naar de client.
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ ok: false, reason: 'server-error' });
});

app.listen(PORT, () => {
  console.log(`Meetingrooms H20 API luistert op http://localhost:${PORT}`);
  ping()
    .then(() => console.log('✓ MySQL-verbinding ok'))
    .catch((err) => console.warn('⚠ MySQL niet bereikbaar:', err.message));
});
