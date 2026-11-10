# Deploy & Beheer — Meetingrooms H20

> **Geheimen staan NIET in dit bestand** (het zit in git/GitHub). De echte
> wachtwoorden, DB- en SSH-gegevens staan in `DEPLOY-SECRETS.local.md` — dat
> bestand is `.gitignore`'d en blijft op de lokale machine.

Laatst bijgewerkt: 2026-06-10

---

## 0. Deployen met deploy.sh (aanbevolen)

Zelfde bediening als de receptie-app:

```bash
bash deploy.sh --controle    # laat zien wat er zou gebeuren, wijzigt niets
bash deploy.sh --deploy      # voert het echt uit
```

De eerste keer, of na handmatig knutselen op de server:

```bash
bash deploy.sh --controle --volledig --opruimen   # eerst kijken
bash deploy.sh --deploy   --volledig --opruimen   # dan doen
```

`--volledig` zet de bestandenrem uit en laat rsync binnen `public/` en
`server/` opruimen wat lokaal niet meer bestaat. `server/.env`,
`node_modules`, `tmp/` en `backups/` worden daarbij nooit aangeraakt: die
staan in de uitsluitlijst en `--delete` laat uitgesloten bestanden met rust.

`--opruimen` haalt daarnaast weg wat helemaal niet op de server hoort — een
`.git`-map, documentatie, losse scripts. Dat lijstje wordt eerst getoond en
staat ook in de reservekopie, dus je kunt altijd terug.

Het script doet achtereenvolgens: lokale syntaxcontrole van alle JS en van de
inline scripts in de pagina's, controleren of de server en `server/.env`
bereikbaar zijn, een rsync-proefrun met de lijst te versturen bestanden, een
reservekopie als tar op de server, het versturen zelf, `npm install` als
`package.json` wijzigde, `migrate.js` als `schema.sql` wijzigde, een herstart
via `tmp/restart.txt`, en tot slot een controle op `/healthz` plus de drie
schermen. Faalt die controle, dan rolt het script zelf terug naar de
reservekopie.

Wat er bewust NIET meegaat: `server/.env`, `node_modules`, `dev-local.js`,
documentatie en de sjablonen in `sheet-templates/`.

Logboek per deploy komt in `deploy-logboek/`.

Terugzetten met de hand kan altijd nog:

```bash
ssh <user>@<host> 'cd ~/meetings.h20.gg && tar xzf backups/deploy-<stempel>/vorige-versie.tar.gz && touch tmp/restart.txt'
```

De handmatige procedure hieronder blijft geldig als achtervang.

---

## 1. Architectuur (kort)

- **Frontend:** vanilla HTML/CSS/JS in `public/` (`index.html`, `login.html`,
  `dashboard.html`, `admin.html`, `tablet.html`, `app.js`, `auth.js`, `kiosk.js`,
  `sw.js`, `styles.css`).
- **Backend:** Node.js + Express + MySQL/MariaDB in `server/` (`server/index.js`).
- **Entrypoint:** repo-root `app.js` → `require('./server/index.js')`.
- **Data:** centrale database (rooms, meetings, users, PINs, history) — 4 tablets
  + dashboard + Beheer delen dezelfde data.
- **Same-origin:** frontend en `/api` draaien onder dezelfde host, zodat de
  httpOnly sessie-cookie werkt zonder CORS-gedoe.

---

## 2. Huidige status

| Omgeving   | Status | Toelichting |
|------------|--------|-------------|
| **Lokaal** | ✅ Werkt end-to-end | MariaDB draait, migratie gedaan, login/dashboard/tablet/admin getest. |
| **Productie** (`https://meetings.h20.gg`) | ✅ Live | Plesk + Passenger draaien `server/index.js`; frontend volledig op de REST-API. |

```bash
curl -s https://meetings.h20.gg/healthz   # {"ok":true,"db":"up"}
```

---

## 3. Hosting-feiten (Plesk + Passenger)

| Onderdeel | Waarde |
|-----------|--------|
| App-root | `~/meetings.h20.gg` |
| Webroot (statische frontend) | `~/meetings.h20.gg/public` |
| Application Startup File | `app.js` (= `require('./server/index.js')`) |
| Node-versie | 24 (`.node-version`) |
| Restart-trigger | `touch ~/meetings.h20.gg/tmp/restart.txt` |
| Database | naam `admin_meetings`, gebruiker `h20meeting` |

Passenger zet `process.env.PORT` zelf; `server/index.js` luistert daarop.

---

## 4. Lokaal draaien (ontwikkelen/testen)

```bash
# 1. Database (eenmalig per boot)
sudo service mariadb start

# 2. Dev-server (frontend + /api same-origin op poort 8080)
cd server
node dev-local.js          # of: npm run dev (alleen API op 4000)
```

- Open: <http://localhost:8080/login.html>
- Healthcheck: `curl http://localhost:8080/healthz` → `{"ok":true,"db":"up"}`
- **Let op:** `dev-local.js` is dev-only en `.gitignore`'d (wordt nooit gepusht).

---

## 5. Deployen (code-update naar productie)

De server heeft een git-checkout van `H20tom/Meetingrooms` (branch `main`).
Standaard-flow:

```bash
# 1. SSH naar de server (gegevens in DEPLOY-SECRETS.local.md)
ssh <user>@<host>

# 2. Code ophalen
cd ~/meetings.h20.gg
git pull origin main

# 3. (alleen als server/package.json wijzigde) productie-deps
cd ~/meetings.h20.gg/server
npm install --omit=dev

# 4. (alleen bij schema-/migratie-wijziging) migratie draaien
node scripts/migrate.js

# 5. Passenger herstarten
touch ~/meetings.h20.gg/tmp/restart.txt
```

> **Frontend-only wijzigingen** (HTML/CSS/JS in `public/`) vereisen geen restart,
> maar bump wél `CACHE_VERSION` in `public/sw.js` (nu `v17`) zodat de service
> worker de nieuwe assets oppikt.

### DB-migratie voor de `h20`-rol (eenmalig)

Een `ALTER TABLE` vereist géén app-restart. Draaien als de DB-gebruiker
`h20meeting` op database `admin_meetings`:

```sql
ALTER TABLE users   MODIFY role ENUM('admin','user','h20') NOT NULL DEFAULT 'user';
ALTER TABLE invites MODIFY role ENUM('admin','user','h20') NOT NULL DEFAULT 'user';
```

### Verifiëren na deploy

```bash
curl -s https://meetings.h20.gg/healthz
#   verwacht: {"ok":true,"db":"up"}

curl -s -X POST https://meetings.h20.gg/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"tom@h20.gg","password":"<admin-wachtwoord>"}'
#   verwacht: {"ok":true,"user":{...,"role":"admin"}}
```

Daarna inloggen op <https://meetings.h20.gg/login.html>.

---

## 6. Login

- E-mail: `tom@h20.gg`
- Wachtwoord: zie `DEPLOY-SECRETS.local.md` (migratie-seed; na de eerste login
  gewijzigd en daarna behouden — de migratie overschrijft een bestaand account niet).
- Nieuwe gebruikers/uitnodigingen + rolwijzigingen lopen via `admin.html`.

---

## 7. Rollen

| Rol     | Mag |
|---------|-----|
| `admin` | Alles: gebruikers/uitnodigingen, wachtwoord-resets, kiosk-config, historie inzien + wissen, meetings beheren. |
| `h20`   | Standaard gebruikersrechten **plus** de vergader-historie inzien en exporteren in Beheer (geen wissen, geen gebruikersbeheer/kiosk). |
| `user`  | Dashboard + meetings starten/verlengen/beëindigen/plannen. Geen toegang tot Beheer. |

---

## 8. Veelvoorkomende problemen

| Symptoom | Oorzaak | Oplossing |
|----------|---------|-----------|
| Lokaal: kan niet inloggen | dev-server (8080) of MariaDB staat uit | `sudo service mariadb start` + `node dev-local.js` |
| Productie: oude assets na deploy | service worker cachet de vorige versie | bump `CACHE_VERSION` in `public/sw.js`, hard refresh |
| Login "werkt" maar redirect niet | browser-cache / service worker | hard refresh; `sw.js` cachet `/api` nooit |
| `db: down` op `/healthz` | DB-creds of MySQL onbereikbaar | controleer `server/.env` DB-waarden |
| `h20`-rol niet te kiezen / insert-fout | DB mist de `h20` ENUM-waarde | ALTER uit §5 draaien |

---

## 9. Beveiliging (checklist)

- [ ] Geen geheimen in git (`.env`, `*.local.md`, `*.key`, `*.pem` zijn genegeerd).
- [ ] `COOKIE_SECURE=true` op productie (HTTPS aanwezig).
- [ ] `CORS_ORIGIN` beperkt tot `https://meetings.h20.gg`.
- [ ] Admin-wachtwoord gewijzigd na de eerste login.
- [ ] DB-gebruiker (`h20meeting`) heeft alleen rechten op de eigen database.
