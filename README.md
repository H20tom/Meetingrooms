# Meetingrooms H20

Reserveringssysteem voor de 4 meetingrooms van H20 Esports Campus Amsterdam
(Edu Lab, Bundled, Lounge Café, Raboroom). Tablet-kiosk per ruimte, een centraal
dashboard, gebruikersbeheer en kiosk-bescherming. Draait **live** op
<https://meetings.h20.gg>.

`Meetings@h20.gg` is het e-maildomein; de app heet **Meetingrooms H20**.

## Stack

- **Frontend:** vanilla HTML/CSS/JS, geen build-step. State komt van de API
  (`window.H20` in `app.js`, `window.Auth` in `auth.js`). Service Worker
  (`sw.js`) cachet de statische assets voor offline-werking; `/api` wordt nooit
  gecachet.
- **Backend:** Node.js + Express + MySQL/MariaDB in `server/`. bcrypt-hashing
  (wachtwoorden én PINs), httpOnly sessie-cookies, same-origin met de frontend.
- **Hosting:** Plesk + Phusion Passenger. App-root `~/meetings.h20.gg`, webroot
  `~/meetings.h20.gg/public`, entrypoint `app.js` (`require('./server/index.js')`),
  Node 24 (`.node-version`).

## Repo-layout

```
.
├── app.js                  # Passenger-entrypoint → require('./server/index.js')
├── .node-version           # 24
├── public/                 # webroot (statische frontend)
│   ├── index.html          # portal / entry-pagina
│   ├── login.html          # inloggen + wachtwoord-reset (via admin)
│   ├── dashboard.html      # centraal overzicht alle 4 ruimtes (+ verlengen/beëindigen)
│   ├── tablet.html         # tablet-kiosk per ruimte (?room=...)
│   ├── admin.html          # beheer: gebruikers, uitnodigingen, historie, resets, kiosk
│   ├── app.js              # window.H20 — rooms/meetings (async REST)
│   ├── auth.js             # window.Auth — login/gebruikers/PIN (async REST)
│   ├── kiosk.js            # kiosk-bescherming (fullscreen, wake-lock, exit-PIN)
│   ├── sw.js               # service worker (offline cache, cachet /api niet)
│   ├── styles.css          # design tokens + H20 branding
│   ├── robots.txt          # interne tool — niet indexeren
│   └── Logo H20 2026.png
├── server/                 # backend-API (zie server/README.md)
├── README.md               # dit bestand
├── PROJECT_PLAN.md         # functionele scope + roadmap
├── DEPLOY.md               # deploy- en beheer-instructies
└── DEPLOY-SECRETS.local.md # echte wachtwoorden/SSH/DB — NIET in git
```

## De 4 meetingrooms

| ID         | Naam        |
|------------|-------------|
| `aquarium` | Edu Lab     |
| `bundled`  | Bundled     |
| `lounge`   | Lounge Café |
| `raboroom` | Raboroom    |

Iedere tablet is via URL-parameter hardcoded aan één ruimte gekoppeld:
`tablet.html?room=aquarium` (en `bundled` / `lounge` / `raboroom`). Geen
ruimte-switcher op de tablet. De id `aquarium` blijft bewust staan na de
hernoeming naar Edu Lab: hij zit in de tablet-bookmarks, in alle bestaande
historie-regels en in de foreign keys. Alleen de weergavenaam is gewijzigd.

## Rollen

| Rol     | Mag |
|---------|-----|
| `admin` | Alles: gebruikers/uitnodigingen beheren, wachtwoord-resets, kiosk-config, historie inzien + wissen, meetings beheren. |
| `h20`   | Standaard gebruikersrechten **plus** de vergader-historie inzien en exporteren in Beheer (geen wissen, geen gebruikersbeheer/kiosk). |
| `user`  | Dashboard bekijken en meetings starten/verlengen/beëindigen/plannen. Geen toegang tot Beheer. |

De tablet-kiosk zelf is bewust openbaar (anders werkt het niet bij de deur);
het dashboard en Beheer vereisen een sessie.

## URLs

- **Portal:** `index.html`
- **Dashboard:** `dashboard.html`
- **Beheer:** `admin.html` (admin + h20)
- **Tablets:** `tablet.html?room=aquarium` · `?room=bundled` · `?room=lounge` · `?room=raboroom`

## Lokaal draaien (ontwikkelen)

De productie-app draait op Plesk; lokaal gebruik je de dev-server die frontend +
`/api` op één origin serveert (zoals productie):

```bash
# 1. Lokale database (eenmalig per boot)
sudo service mariadb start

# 2. Dev-server: frontend + /api same-origin op poort 8080
cd server
node dev-local.js
```

- Open: <http://localhost:8080/login.html>
- Healthcheck: `curl http://localhost:8080/healthz` → `{"ok":true,"db":"up"}`
- `dev-local.js` is **dev-only** en `.gitignore`'d — wordt nooit gepusht.
- Backend-setup, migratie en endpoints: zie [`server/README.md`](server/README.md).

## Login

- E-mail: `tom@h20.gg`
- Wachtwoord: het actuele wachtwoord staat in `DEPLOY-SECRETS.local.md` (de
  migratie-seed wordt na de eerste login gewijzigd en blijft daarna behouden).

Nieuwe gebruikers/uitnodigingen + rolwijzigingen lopen via `admin.html`.

## Deploy

Code staat op GitHub (`H20tom/Meetingrooms`, branch `main`). Op de server:
`git pull` → eventuele DB-migratie → `touch tmp/restart.txt`. Volledige stappen,
verificatie en troubleshooting: zie [`DEPLOY.md`](DEPLOY.md).

## Status

- [x] Tablet beschikbaar/bezet, reserveren (30/60/90/anders), verlengen (+15/+30/+60), beëindigen
- [x] Vooraf plannen + conflict-bescherming
- [x] Centraal dashboard met verlengen/beëindigen vanaf de kaart
- [x] PIN bij account-aanmaak (tablet-check-in)
- [x] Login + gebruikersbeheer, uitnodigingen, wachtwoord-resets (admin-gestuurd)
- [x] Rollen `admin` / `user` / `h20`
- [x] Offline-cache (service worker) + kiosk-bescherming
- [x] Backend live op MySQL/MariaDB, frontend volledig op de REST-API
- [x] Productie live op <https://meetings.h20.gg> (Plesk + Passenger)
- [ ] Outlook/Google Calendar-sync (fase 3)
- [ ] Fysieke tablet-rollout in kiosk-mode (fase 4)
