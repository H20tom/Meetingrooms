# Meetingrooms H20 — Backend API

Express + MySQL backend voor de Meetingrooms H20 app. Spiegelt het bestaande
`window.H20` (rooms/meetings) en `window.Auth` (gebruikers/sessies) API-oppervlak,
zodat de frontend later 1-op-1 gekoppeld kan worden. De frontend draait voorlopig
nog op `localStorage` en wordt in deze stap **niet** gewijzigd.

## Vereisten

- Node.js 18+ en npm
- Toegang tot een MySQL-database (lokaal of op Johan's SSH-server)

## Installatie

```bash
cd "Meetingroom Project/server"
npm install
cp .env.example .env   # vul daarna je DB-gegevens in
```

## Configuratie (`.env`)

| Variabele        | Betekenis                                              |
|------------------|--------------------------------------------------------|
| `PORT`           | Poort van de API (default 4000)                        |
| `CORS_ORIGIN`    | Toegestane frontend-origins, komma-gescheiden          |
| `SESSION_SECRET` | Geheime sleutel (zet een lange random waarde)          |
| `COOKIE_SECURE`  | `true` achter HTTPS, anders `false` (lokaal)           |
| `DB_HOST`        | MySQL host                                             |
| `DB_PORT`        | MySQL poort (default 3306)                             |
| `DB_USER`        | MySQL gebruiker                                         |
| `DB_PASSWORD`    | MySQL wachtwoord                                        |
| `DB_NAME`        | Databasenaam (default `meetingrooms_h20`)              |
| `DB_SSL`         | `true` voor TLS naar remote MySQL                      |

`.env` staat in `.gitignore` — commit nooit credentials. Alleen `.env.example`
gaat de repo in.

## Verbinden met Johan's MySQL-server

Drie scenario's:

1. **API draait óp de server** — `DB_HOST=localhost`, `DB_PORT=3306`.
2. **API lokaal, DB remote via SSH-tunnel** (aanbevolen voor ontwikkelen):
   ```bash
   ssh -L 3306:localhost:3306 johan@<server-host>
   ```
   Laat dit venster open en zet in `.env`: `DB_HOST=127.0.0.1`, `DB_PORT=3306`.
3. **Directe remote MySQL** — `DB_HOST=<server-ip>`, eventueel `DB_SSL=true`.

## Database opzetten (migratie)

`npm run migrate` past `schema.sql` toe (tabellen + 4 rooms-seed) en maakt de
admin-gebruiker aan met een bcrypt-hash:

```bash
npm run migrate
```

- Admin: `tom@h20.gg` / wachtwoord `H20esports@`
- Idempotent: bestaande admin wordt overgeslagen, schema gebruikt
  `CREATE TABLE IF NOT EXISTS` + `ON DUPLICATE KEY UPDATE`.

## Server starten

```bash
npm start        # productie
npm run dev      # met --watch (herstart bij wijzigingen)
```

De API luistert op `http://localhost:<PORT>`.

## Smoke-tests

```bash
# 1. Healthcheck (bevestigt DB-verbinding)
curl -s http://localhost:4000/healthz

# 2. Inloggen → sessie-cookie in cookies.txt
curl -s -c cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"tom@h20.gg","password":"H20esports@"}'

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

### Rooms / meetings (`routes/rooms.js`)
- `GET    /api/rooms`
- `GET    /api/rooms/:id/status`
- `GET    /api/rooms/:id/scheduled`
- `POST   /api/rooms/:id/start`
- `POST   /api/rooms/:id/extend`
- `POST   /api/rooms/:id/end`
- `POST   /api/rooms/:id/schedule`
- `DELETE /api/rooms/:id/scheduled/:mid`
- `GET    /api/history` (auth) · `DELETE /api/history` (admin)

### Auth / gebruikers (`routes/auth.js`)
- `POST   /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- `GET    /api/users` (auth) · `GET /api/users/quickpick`
- `POST   /api/users` · `PATCH /api/users/:id` · `DELETE /api/users/:id` (admin)
- `POST   /api/users/:id/pin` (admin/zelf) · `DELETE /api/users/:id/pin` (admin)
- `POST   /api/users/pin/verify`
- `POST   /api/invites` · `GET /api/invites` (admin) · `GET /api/invites/:token`
- `POST   /api/invites/:token/consume` · `DELETE /api/invites/:token` (admin)
- `POST   /api/auth/reset/request` · `POST /api/auth/reset/consume`
- `POST   /api/users/:id/pin-setup` (admin) · `POST /api/pin-setup/:token/consume`

## Responsformaat

Alle endpoints retourneren een envelope: `{ ok: true, ... }` of
`{ ok: false, reason: '<code>' }`. Dit spiegelt de huidige frontend-returnwaarden.

## Buiten scope (later)

- Frontend ombouwen van synchroon `localStorage` naar async API-calls.
- Realtime sync (polling of websockets).
- Deploy / process-manager (pm2 of systemd) op de server.
