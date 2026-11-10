'use strict';

// Laadt schema.sql in de MySQL-database en seedt de admin-gebruiker (bcrypt).
// Gebruik: npm run migrate

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'tom@h20.gg';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'Tom';
// Het seed-wachtwoord staat bewust NIET in de code: dit bestand zit in git.
// Zet SEED_ADMIN_PASSWORD in server/.env (of in de omgeving) vóór de eerste
// migratie. Bestaat de admin al, dan is de variabele niet nodig.
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || '';

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
      if (!ADMIN_PASSWORD) {
        throw new Error(
          'SEED_ADMIN_PASSWORD ontbreekt. De admin bestaat nog niet, dus er is een ' +
            'seed-wachtwoord nodig. Zet SEED_ADMIN_PASSWORD in server/.env en draai opnieuw.',
        );
      }
      if (ADMIN_PASSWORD.length < 12) {
        throw new Error('SEED_ADMIN_PASSWORD is te kort — gebruik minimaal 12 tekens.');
      }
      const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      const id = 'u-tom-' + Date.now().toString(36);
      await conn.execute(
        'INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, ADMIN_EMAIL, ADMIN_NAME, 'admin', hash, nowUtc()],
      );
      // Het wachtwoord zelf wordt niet gelogd — het staat al in de omgeving
      // van degene die de migratie draait.
      console.log(`  ✓ Admin aangemaakt: ${ADMIN_EMAIL} (wachtwoord uit SEED_ADMIN_PASSWORD)`);
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
