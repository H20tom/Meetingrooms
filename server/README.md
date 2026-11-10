# Meetingrooms H20 — Backend API

Node.js + Express + MySQL/MariaDB backend voor de Meetingrooms H20 app. Levert de
data voor `window.H20` (rooms/meetings) en `window.Auth` (gebruikers/sessies); de
frontend draait **volledig** op deze REST-API (geen `localStorage` meer als bron
van waarheid). Draait live op <https://meetings.h20.gg> (Plesk + Passenger).

## Vereisten

- Node.js 24 (zie `.node-version` in de repo-root)
- npm
- Een MySQL/MariaDB-database (lokaal voor dev, of de productie-DB op Plesk)

## Installatie

```bash
cd server
npm install
cp .env.example .env   # vul daarna je DB-gegevens in
```

## Configuratie (`.env`)

| Variabele        | Betekenis                                              |
|------------------|--------------------------------------------------------|
| `PORT`           | Poort van de API (default 4000; Passenger zet dit zelf)|
| `CORS_ORIGIN`    | Toegestane frontend-origins, komma-gescheiden          |
| `SESSION_SECRET` | Geheime sleutel (zet een lange random waarde)          |
| `COOKIE_SECURE`  | `true` achter HTTPS (productie), anders `false` (lokaal)|
| `DB_HOST`        | MySQL host                                             |
| `DB_PORT`        | MySQL poort (default 3306)                             |
| `DB_USER`        | MySQL gebruiker                                         |
| `DB_PASSWORD`    | MySQL wachtwoord                                        |
| `DB_NAME`        | Databasenaam                                           |
| `DB_SSL`         | `true` voor TLS naar remote MySQL                      |

`.env` staat in `.gitignore` — commit nooit credentials. Alleen `.env.example`
gaat de repo in. De echte productie-waarden staan in `DEPLOY-SECRETS.local.md`
(buiten git).

## Database opzetten (migratie)

`npm run migrate` past `schema.sql` toe (tabellen + 4 rooms-seed) en maakt de
admin-gebruiker aan met een bcrypt-hash:

```bash
npm run migrate
```

- Admin-seed: `tom@h20.gg`. Het seed-wachtwoord komt uit `SEED_ADMIN_PASSWORD`
  in `server/.env` en staat nergens in de code. Alleen nodig bij de eerste
  migratie; bestaat de admin al, dan slaat het script het over.
- Idempotent: een **bestaand** admin-account wordt niet overschreven (een na de
  eerste login gewijzigd wachtwoord blijft dus behouden). Schema gebruikt
  `CREATE TABLE IF NOT EXISTS` + `ON DUPLICATE KEY UPDATE`.
- Tabellen: `rooms`, `active_meetings`, `scheduled_meetings`, `meeting_history`,
  `users`, `sessions`, `invites`, `password_resets`, `pin_setups`.

### Rollen-migratie (`admin` / `user` / `h20`)

De `role`-kolom in `users` en `invites` is `ENUM('admin','user','h20')`. Een
bestaande productie-DB zonder de `h20`-waarde heeft eenmalig een ALTER nodig
(geen app-restart vereist):

```sql
ALTER TABLE users   MODIFY role ENUM('admin','user','h20') NOT NULL DEFAULT 'user';
ALTER TABLE invites MODIFY role ENUM('admin','user','h20') NOT NULL DEFAULT 'user';
```

## Server starten

```bash
npm start        # productie (server/index.js)
npm run dev      # met --watch (herstart bij wijzigingen), alleen API op PORT
```

Voor lokaal **frontend + API same-origin** (zoals productie) is er een dev-only
script in de repo-root van `server/`: `node dev-local.js` (poort 8080). Dat
bestand is `.gitignore`'d en wordt nooit gepusht.

## Smoke-tests

```bash
# 1. Healthcheck (bevestigt DB-verbinding)
curl -s http://localhost:4000/healthz        # {"ok":true,"db":"up"}

# 2. Inloggen → sessie-cookie in cookies.txt
curl -s -c cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"tom@h20.gg","password":"<wachtwoord>"}'

# 3. Wie ben ik (met cookie)
curl -s -b cookies.txt http://localhost:4000/api/auth/me

# 4. Meeting starten in 'aquarium'
curl -s -X POST http://localhost:4000/api/rooms/aquarium/start \
  -H 'Content-Type: application/json' \
  -d '{"durationMin":30,"email":"iemand@h20.gg"}'

# 5. Status opvragen → 'busy'
curl -s http://localhost:4000/api/rooms/aquarium/status
```

## Endpoints

Auth-niveaus: **(open)** = geen sessie nodig · **(auth)** = ingelogd ·
**(admin)** = rol `admin` · **(admin/h20)** = rol `admin` óf `h20`.

### Rooms / meetings (`routes/rooms.js`)
- `GET    /api/rooms` (open)
- `GET    /api/rooms/:id/status` (open)
- `GET    /api/rooms/:id/scheduled` (open)
- `POST   /api/rooms/:id/start` (open — tablet-kiosk)
- `POST   /api/rooms/:id/extend` (open)
- `POST   /api/rooms/:id/end` (open)
- `POST   /api/rooms/:id/schedule` (open)
- `DELETE /api/rooms/:id/scheduled/:mid` (open)
- `GET    /api/history` (admin/h20) · `DELETE /api/history` (admin)

> De room-mutatie-endpoints zijn bewust open: de tablet bij de deur draait zonder
> sessie. Het dashboard en Beheer vereisen wel een sessie.

### Auth / gebruikers (`routes/auth.js`)
- `POST   /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` (auth)
- `GET    /api/users` (auth) · `GET /api/users/quickpick` (open — tablet check-in)
- `POST   /api/users` · `PATCH /api/users/:id` · `DELETE /api/users/:id` (admin)
- `POST   /api/users/:id/pin` (auth) · `DELETE /api/users/:id/pin` (admin)
- `POST   /api/users/pin/verify` (open)
- `POST   /api/invites` (admin) · `GET /api/invites` (admin) · `GET /api/invites/:token` (open)
- `POST   /api/invites/:token/consume` (open) · `DELETE /api/invites/:token` (admin)
- `POST   /api/auth/reset/request` (admin) · `GET /api/auth/resets` (admin) · `POST /api/auth/reset/consume` (open)
- `POST   /api/users/:id/pin-setup` (admin) · `POST /api/pin-setup/:token/consume` (open)

## Responsformaat

Alle endpoints retourneren een envelope: `{ ok: true, ... }` of
`{ ok: false, reason: '<code>' }`. Lijsten staan onder `data`. Wachtwoorden én
PINs worden met bcrypt (cost 12) gehasht; hash-kolommen verlaten nooit de server.

## Buiten scope (later)

- Realtime sync via WebSockets (nu: polling vanaf de frontend).
- Outlook/Google Calendar-sync (fase 3).
- Process-manager-tuning; Passenger beheert het Node-proces op Plesk.
