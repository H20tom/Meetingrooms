'use strict';

const mysql = require('mysql2/promise');

const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'meetingrooms_h20',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // MySQL DATETIME-kolommen als UTC-strings behandelen; conversie doen we in JS.
  timezone: 'Z',
  dateStrings: true,
  ssl: useSsl ? { rejectUnauthorized: true } : undefined,
});

// Korte ping om de verbinding bij startup te valideren.
async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
  } finally {
    conn.release();
  }
}

module.exports = { pool, ping };
