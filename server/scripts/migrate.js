'use strict';

// Laadt schema.sql in de MySQL-database en seedt de admin-gebruiker (bcrypt).
// Gebruik: npm run migrate

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const ADMIN_EMAIL = 'tom@h20.gg';
const ADMIN_NAME = 'Tom';
const ADMIN_PASSWORD = 'H20esports@';

function nowUtc() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'meetingrooms_h20',
    multipleStatements: true,
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: true }
      : undefined,
  });

  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    console.log('→ Schema toepassen...');
    await conn.query(sql);
    console.log('  ✓ Tabellen + rooms-seed klaar.');

    const [rows] = await conn.execute(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
      [ADMIN_EMAIL],
    );
    if (rows.length === 0) {
      const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      const id = 'u-tom-' + Date.now().toString(36);
      await conn.execute(
        'INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, ADMIN_EMAIL, ADMIN_NAME, 'admin', hash, nowUtc()],
      );
      console.log(`  ✓ Admin aangemaakt: ${ADMIN_EMAIL} (wachtwoord: ${ADMIN_PASSWORD})`);
    } else {
      console.log(`  • Admin bestaat al: ${ADMIN_EMAIL} (overgeslagen)`);
    }

    console.log('✓ Migratie voltooid.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('✗ Migratie mislukt:', err.message);
  process.exit(1);
});
