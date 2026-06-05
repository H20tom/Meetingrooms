# Deploy & Status — Meetingrooms H20

> **Geheimen staan NIET in dit bestand** (het zit in git/GitHub). De echte
> wachtwoorden, DB- en SSH-gegevens staan in `DEPLOY-SECRETS.local.md` — dat
> bestand is `.gitignore`'d en blijft op de lokale machine.

Laatst bijgewerkt: 2026-05-29

---

## 1. Architectuur (kort)

- **Frontend:** vanilla HTML/CSS/JS (`index.html`, `login.html`, `dashboard.html`,
  `admin.html`, `tablet.html`, `app.js`, `auth.js`).
- **Backend:** Node + Express + MySQL/MariaDB in `server/` (`index.js` = startbestand).
- **Data:** centrale database (rooms, meetings, users, PIN's, history). Geen
  `localStorage` meer als bron van waarheid → 4 tablets + event managers delen
  dezelfde data.
- **Same-origin:** frontend en `/api` draaien onder dezelfde host, zodat de
  httpOnly sessie-cookie werkt zonder CORS-gedoe.

---

## 2. Huidige status

| Omgeving   | Status | Toelichting |
|------------|--------|-------------|
| **Lokaal** | ✅ Werkt end-to-end | MariaDB draait, migratie gedaan, login/dashboard/tablet/admin getest. |
| **Productie** (`https://meetings.h20.gg`) | ⚠️ Frontend live, **API draait nog niet** | Passenger draait een stub-app: elke `/api`-call geeft `NODE-OK v24.16.0` (platte tekst) i.p.v. JSON → inloggen mislukt. |

**Diagnose productie (29-05):**
```
curl https://meetings.h20.gg/         → 200, jouw HTML (nginx, statisch)  ✅
curl https://meetings.h20.gg/healthz  → 200 "NODE-OK v24.16.0" (text/plain) ❌
curl https://meetings.h20.gg/api/auth/me → idem "NODE-OK v24.16.0"          ❌
```
→ Het Passenger-startbestand verwijst naar een stub, niet naar `server/index.js`.

---

## 3. Lokaal draaien (ontwikkelen/testen)

```bash
# 1. Database (eenmalig per boot)
sudo service mariadb start

# 2. Dev-server (frontend + /api same-origin op poort 8080)
cd "Claude/Meetingroom Project/server"
node dev-local.js          # of: npm run dev (alleen API op 4000)
```

- Open: <http://localhost:8080/login.html>
- Healthcheck: `curl http://localhost:8080/healthz` → `{"ok":true,"db":"up"}`
- **Let op:** `dev-local.js` is dev-only en `.gitignore`'d (wordt nooit gepusht).
- Sluit je de terminal/computer af → poort 8080 stopt; herstart met bovenstaande.

---

## 4. Productie-fix (deploy-stappen)

> Vereist SSH-toegang tot de Plesk-server. Echte host/user/wachtwoord:
> zie `DEPLOY-SECRETS.local.md`.

Paden op de server:
- App-root: `~/meetings.h20.gg`
- Webroot (statische frontend): `~/meetings.h20.gg/public`
- Passenger-startbestand: het bestand dat Plesk als "Application Startup File"
  gebruikt (geeft nu `NODE-OK` terug).

### Stappen

```bash
# 0. SSH naar de server (gegevens in DEPLOY-SECRETS.local.md)
ssh <user>@<host>

# 1. Code ophalen/bijwerken (git of rsync vanaf lokaal)
cd ~/meetings.h20.gg
git pull           # als er een git-checkout op de server staat
#   of vanaf lokaal:  rsync -av --exclude node_modules --exclude .env \
#                     "./" <user>@<host>:~/meetings.h20.gg/

# 2. Dependencies (productie-only)
cd ~/meetings.h20.gg/server
npm install --omit=dev

# 3. .env aanmaken op de server (NIET in git) — zie DEPLOY-SECRETS.local.md
#    Belangrijk voor productie:
#      COOKIE_SECURE=true
#      CORS_ORIGIN=https://meetings.h20.gg
#      PORT=<poort die Passenger toewijst; Passenger zet process.env.PORT zelf>

# 4. Database initialiseren (tabellen + 4 rooms + admin)
node scripts/migrate.js

# 5. Passenger-stub vervangen door de echte app
#    Het startbestand moet effectief dit doen:
#        require('./server/index.js');
#    (server/index.js luistert op process.env.PORT die Passenger zet)

# 6. Passenger herstarten
mkdir -p ~/meetings.h20.gg/tmp
touch ~/meetings.h20.gg/tmp/restart.txt
```

### Verifiëren na deploy

```bash
curl -s https://meetings.h20.gg/healthz
#   verwacht: {"ok":true,"db":"up"}   (JSON, GEEN "NODE-OK")

curl -s -X POST https://meetings.h20.gg/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"tom@h20.gg","password":"<admin-wachtwoord>"}'
#   verwacht: {"ok":true,"user":{...,"role":"admin"}}
```

Daarna inloggen op <https://meetings.h20.gg/login.html>.

> **Na de eerste succesvolle login: wijzig het admin-wachtwoord.**

---

## 5. Login

- E-mail: `tom@h20.gg`
- Wachtwoord: zie `DEPLOY-SECRETS.local.md` (standaard seed; na deploy wijzigen).
- De migratie overschrijft een **bestaand** account niet — een gewijzigd
  wachtwoord blijft dus behouden bij een volgende migratie.

---

## 6. Veelvoorkomende problemen

| Symptoom | Oorzaak | Oplossing |
|----------|---------|-----------|
| Lokaal: kan niet inloggen | dev-server (8080) of MariaDB staat uit | `sudo service mariadb start` + `node dev-local.js` |
| Productie: `NODE-OK v...` op `/api/*` | Passenger draait de stub | Stub vervangen door `require('./server/index.js')` + restart (§4) |
| Login "werkt" maar redirect niet | browser-cache / service worker | hard refresh; sw.js cachet `/api` niet (cache v15) |
| `db: down` op /healthz | DB-creds of MySQL onbereikbaar | controleer `server/.env` DB-waarden |

---

## 7. Beveiliging (checklist)

- [ ] Geen geheimen in git (`.env`, `*.local.md`, `*.key`, `*.pem` zijn genegeerd).
- [ ] `COOKIE_SECURE=true` op productie (HTTPS aanwezig).
- [ ] `CORS_ORIGIN` beperkt tot `https://meetings.h20.gg`.
- [ ] Admin-wachtwoord gewijzigd na eerste login.
- [ ] DB-gebruiker heeft alleen rechten op de eigen database.
