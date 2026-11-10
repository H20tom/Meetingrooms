# Meetingrooms H20 — Project Plan

> **Status**: ✅ Fase 1 & 2 voltooid — backend live op MySQL/MariaDB, frontend volledig op de REST-API
> **Live**: <https://meetings.h20.gg> (Plesk + Phusion Passenger)
> **Volgende stap**: Fase 3 (Outlook/Google Calendar-sync) + fase 4 (fysieke tablet-rollout in kiosk-mode)
> **Naam vs. domein**: app heet **Meetingrooms H20**; `Meetings@h20.gg` is het e-maildomein
> **Eigenaar**: Tom · H20 Esports Campus Amsterdam
> **Laatst bijgewerkt**: 2026-06-10

---

## 1. Doel

Een tablet-systeem bij iedere meetingroom + één centraal online dashboard, waarmee medewerkers:

1. In één oogopslag zien of een ruimte vrij of bezet is (groen / rood).
2. Direct een vergadering kunnen starten via touchscreen.
3. Een vergadering kunnen verlengen of vroegtijdig beëindigen.
4. **Vergaderingen vooraf kunnen inplannen** (bijv. 13:00, 16:00, 19:00 op dezelfde dag).
5. Op een centraal dashboard meerdere ruimtes tegelijk zien.

Realtime sync tussen alle schermen.

---

## 2. Meetingrooms

4 vaste ruimtes — geen ruimte-switcher op de tablets:

| ID         | Naam        | Locatie                          |
|------------|-------------|----------------------------------|
| `aquarium` | Edu Lab     | Glazen ruimte · 1e verdieping    |
| `bundled`  | Bundled     | Brainstormruimte · 1e verdieping |
| `lounge`   | Lounge Café | Café-zone · 1e verdieping        |
| `raboroom` | Raboroom    | Vergaderruimte · 1e verdieping   |

Iedere tablet wordt via URL-parameter hardcoded aan één ruimte gekoppeld:
- `tablet.html?room=aquarium`
- `tablet.html?room=bundled`
- `tablet.html?room=lounge`
- `tablet.html?room=raboroom`

---

## 3. Functionele scope

### 3.1 Tablet — Beschikbaar (groen scherm)
- Grote tekst "Beschikbaar"
- Live klok + datum
- H20 logo (donkere achtergrond)
- Knoppen om direct te starten: **30 min · 60 min · 90 min · Anders**
- Iedere knop toont eindtijd-preview ("tot 14:30")
- "Anders" → modal met snelle keuzes (15/45/120 min) of vrije input
- **Knop "Plannen"** → modal voor vooraf inplannen (zie 3.5)
- **Verplichte e-mail bij reserveren** (zie 3.7)
- **Geen tijdslimiet** op duur (zie 3.8)

### 3.2 Tablet — Bezet (rood scherm)
- Grote tekst "Bezet tot HH:MM"
- Aantal minuten resterend
- Verleng-knoppen: **+15 · +30 · +60**
- Knop "Vergadering beëindigen" (met bevestigingsmodal)
- **Conflict-bescherming**: zie 3.6

### 3.3 Centraal Dashboard
- Live overzicht alle 4 ruimtes
- Per ruimte: status, eindtijd, voortgangsbalk, gestart om
- Summary-pillen: aantal beschikbaar / bezet / eerstvolgende vrij moment
- **Sectie "Geplande vergaderingen"** met chronologische lijst per ruimte
- Klik op ruimte-kaart → opent tablet-view in nieuw venster

### 3.4 Realtime Sync
- **Huidig (productie)**: polling op de MySQL-backend via de REST-API.
- **Later**: eventueel WebSockets voor push i.p.v. polling.

### 3.5 Plannen (nieuwe feature)

Een meeting van tevoren plannen:

**Op de tablet (knop "Plannen" in beschikbaar-state):**
1. Kies datum (default: vandaag, max: +7 dagen vooruit)
2. Kies starttijd (HH:MM, in stappen van 15 min)
3. Kies duur (30/60/90/eigen)
4. Optioneel: titel ("Sprint review", "Klant XYZ")
5. Bevestig → komt in de agenda van die ruimte

**Op het dashboard:**
- Lijst van komende geplande meetings per ruimte
- Mogelijkheid om geplande meetings te annuleren

**Logica bij start van het tijdslot:**
- Tablet-status springt automatisch naar "bezet" zodra de starttijd bereikt is
- Eindtijd = starttijd + geplande duur
- Wel knop "Vroegtijdig beëindigen" zichtbaar

### 3.6 Conflict-bescherming bij verlengen / starten

**Probleem dat we voorkomen:**
> Een meeting eindigt om 15:00. Er staat een geplande meeting om 15:15.
> Iemand klikt "+30 min" → zou eindigen om 15:30 → conflict met geplande meeting.

**Oplossing — drie lagen:**

1. **Knop-disable**: Verleng-knoppen worden visueel gedeactiveerd (50% opacity, niet klikbaar) zodra ze over de volgende geplande start gaan. Op de knop verschijnt een uitleg-tooltip ("max +12 min").
2. **Toast-melding** (rood, fade-in onderin het scherm): klikken op een geblokkeerde knop toont:
   > "**Niet mogelijk** — om 15:15 begint een geplande meeting (Sprint Review). Maximaal +12 minuten verlengen tot 15:12, of beëindig deze meeting eerder."
3. **Slimme suggestie**: als gebruiker bijvoorbeeld op +30 klikt en het max is +12, biedt de toast een knop "Wel +12 min verlengen" aan.

**Bij starten van een nieuwe meeting (gewone of via "Anders"):**
- Zelfde check tegen volgende geplande slot
- Toast: *"Niet mogelijk — om 13:00 begint een geplande meeting. Maximaal 45 min beschikbaar."*
- Aanbod: "Start 45 min meeting"

**Bij plannen van een meeting:**
- Check op overlap met bestaande geplande meetings én lopende meeting
- Toast: *"Tijdslot bezet — er staat al een meeting van 13:00 tot 14:00."*

### 3.7 E-mail bij reserveren

Geen wachtwoord, geen account — alleen een e-mailadres zodat we **weten wie de reservering heeft gemaakt** (audit trail).

**Verplicht bij:**
- Direct starten (30/60/90/Anders)
- Vooraf plannen
- Verlengen vraagt **niet** opnieuw om e-mail (zelfde reserveerder)

**UX — quick-domain knoppen:**
Net als populaire login-flows tonen we onder het email-veld vier knoppen die het meest gebruikte domein in één tik invullen:
| Knop          | Voegt toe       |
|---------------|-----------------|
| `@h20.gg`     | `@h20.gg`       |
| `@gmail.com`  | `@gmail.com`    |
| `@hotmail.com`| `@hotmail.com`  |
| `@outlook.com`| `@outlook.com`  |

Gedrag van de pills:
- Pill is alléén klikbaar als het veld een tekst-deel bevat (bijv. `tom`) zonder `@`.
- Klik → veld wordt `tom@h20.gg`.
- Als veld al `@iets` bevat: pill vervangt het domein.
- Validatie: minimaal `iets@iets.iets`.

**Onthouden:** laatst gebruikte e-mail wordt opgeslagen in `localStorage` (key `h20-last-email`) en vooraf ingevuld in het veld bij volgende reservering. Per meeting wordt het bij opslag wel apart opgeslagen — nieuwe reserveerder kan altijd overschrijven.

**Zichtbaarheid:**
- Tablet bezet-state toont onderin: *"Geboekt door tom@h20.gg"*
- Dashboard kaartjes tonen email onder elke geplande/lopende meeting.
- (Later: e-mail kan ook gebruikt worden voor reminders / no-show pings.)

### 3.8 Geen tijdslimiet

Een ruimte mag voor onbeperkte tijd geboekt worden:
- Geen maximum op `Anders` duur (was 480 min, nu onbeperkt).
- Geen maximum op verlengen — `+60` mag herhaald geklikt worden tot 3, 5, 10 uur.
- Bij plannen: geen maximum op duur per slot.
- **Enige rem**: de conflict-check tegen volgende geplande meeting (zie 3.6).

Praktisch: de input accepteert iedere positieve waarde ≥ 5 minuten. Op het scherm wordt lange duur netjes weergegeven (`tot 14:30 morgen` als het over middernacht heen gaat — latere verbetering).

### 3.9 Offline-mode (kritiek voor productie)

De tablet bij de deur mag **nooit** offline een witte pagina tonen. WiFi valt incidenteel weg op de campus en het systeem moet daar tegen kunnen.

**Aanpak (huidig):**
- **Service Worker** (`public/sw.js`) cachet de statische assets (HTML/CSS/JS/logo)
  bij eerste bezoek; navigatie is network-first met cache-fallback, `/api` wordt
  nooit gecachet (zaalstatus moet altijd live zijn).
- **Offline indicator**: subtiele banner die eerlijk meldt dat acties niet
  doorgaan zolang er geen netwerk is (geen valse belofte van een lokale queue).
- Bij `'unknown'`-status (server onbereikbaar) toont de tegel een neutrale staat,
  géén valse "Beschikbaar".

**Mogelijke uitbreiding (later):**
- Offline action-queue met server-sync en conflict-resolutie (server is source of
  truth; bij overlap krijgt eerst-geboekt voorrang). Bewust nog niet gebouwd om geen
  valse zekerheid te wekken.

### 3.10 Kiosk-bescherming

De tablet moet zich gedragen als **één-doel-apparaat**. Gebruikers mogen niet uit de app klikken, niet naar browser-instellingen, niet andere tabs openen.

**Lagen van bescherming** (combinatie van app + OS):

| Laag | Implementatie | Wie regelt |
|---|---|---|
| **Fullscreen lock** | `requestFullscreen()` bij eerste interactie, terug-naar-fullscreen on resize/blur | App (`kiosk.js`) |
| **Geen rechtermuisknop** | `contextmenu` event preventDefault | App |
| **Geen tekst-selectie** | `user-select: none` via CSS body | App |
| **Geen pinch-zoom** | `touch-action: manipulation` + meta viewport `user-scalable=no` | App |
| **Geen swipe-naar-vorige-pagina** | `overscroll-behavior: contain` + history-trap | App |
| **Wake-lock** | `navigator.wakeLock.request('screen')` — scherm niet uitzetten | App |
| **Anti-escape**: F11/F12/Ctrl+W/Alt+F4 | keydown preventDefault op gevaarlijke combo's | App |
| **Exit-PIN** | Lang indrukken (3 sec) van logo opent PIN-prompt. Default PIN `2026`, configureerbaar via admin-panel | App |
| **Auto-reboot** | Cronjob op het apparaat dat dagelijks om 04:00 herstart | OS / device admin |
| **Guided Access (iPad) / Kiosk Mode (Android)** | OS-instelling met PIN | OS |
| **Browser-app van keuze** | *Fully Kiosk Browser* (Android) of *Kiosk Pro* (iPad) — block adressbalk, links, status bar | OS |

**Admin-panel** (in `admin.html`):
- Veld voor exit-PIN.
- Toggle voor wake-lock aan/uit.
- Toggle "verberg klok in fullscreen".

### 3.11 Philips Hue — ambient LEDs buiten de ruimtes  *(GEPARKEERD — niet implementeren tenzij Tom er expliciet om vraagt)*

> **Status 2026-05-11**: bewust verwijderd uit de codebase op verzoek van Tom. Specificatie hieronder bewaard voor toekomstig hergebruik. Bestanden die destijds bestonden: `hue.js`, Hue-panel in `admin.html`, wiring in `tablet.html` en `dashboard.html`. Bij heractivering: alleen rood/groen — geen pulse / tussenstaten.

Hue-lampen of LED-strips boven/naast iedere deur tonen de status zonder dat iemand op de tablet hoeft te kijken.

**Gedrag:**
| Status                                     | Hue-effect                          |
|--------------------------------------------|-------------------------------------|
| Beschikbaar                                | Vol groen (helderheid 70%)          |
| Bezet                                      | Vol rood (helderheid 70%)           |
| Bezet, < 5 min resterend                   | Rood met langzame pulse (3s cyclus) |
| Beschikbaar, geplande meeting < 5 min      | Groen met snelle pulse (1s cyclus)  |
| Offline / Hue niet bereikbaar              | Geen actie (stil falen)             |

**Architectuur:**
- `hue.js` — losse module, importeerbaar overal. API: `setRoomLight(roomId, mode)` waar mode = `available | busy | busy-ending | available-soon | off`.
- Configuratie in `localStorage` key `h20-hue-config`:
  ```js
  {
    enabled: true,
    bridgeIp: "192.168.1.42",
    apiKey: "ABCDEF...",            // Hue Bridge "username" token
    mapping: {
      raboroom: "5",                // Hue light ID
      aquarium: "7",
      bundled: "12"
    }
  }
  ```
- **Discovery**: knop *"Zoek bridge"* in admin → roept `https://discovery.meethue.com/` aan → toont gevonden IP's.
- **Pairing**: gebruiker drukt physical knop op de Hue Bridge → app roept `POST /api/` aan → krijgt API-key terug.
- **Mock-mode**: als `enabled: false`, toont admin-panel een simulatie-rij met 3 LED's die hun staat tonen — handig voor demo zonder fysieke bridge.

**Triggers**: ieder render() van `tablet.html` en het sync-loop in `dashboard.html` roept `hue.setRoomLight(roomId, computedMode)` aan. `hue.js` debouncet identieke calls (geen spam).

**CORS-waarschuwing**: Hue Bridge accepteert lokale HTTPS-calls met self-signed cert. Voor productie wordt een mini-proxy aanbevolen (Nginx of Node) zodat de browser niet over de self-signed cert struikelt. Documenteren in deploy-guide.

### 3.12 Login & gebruikersbeheer (dashboard)

**Doel**: het tablet-scherm blijft openbaar (anders werkt het niet bij de deur), maar het **dashboard** + **admin-panel** is alleen voor ingelogde gebruikers.

**Rollen:**
| Rol     | Mag                                                                |
|---------|---------------------------------------------------------------------|
| `admin` | Alles. Gebruikers/uitnodigingen beheren, wachtwoord-resets, kiosk configureren, historie inzien + wissen, alle meetings beheren. |
| `h20`   | Standaard gebruikersrechten **plus** de vergader-historie inzien en exporteren in Beheer (geen wissen, geen gebruikersbeheer/kiosk). |
| `user`  | Dashboard bekijken en meetings starten/verlengen/beëindigen/plannen. Geen toegang tot Beheer. |

Implementatie: `role ENUM('admin','user','h20')` in `users` + `invites`; middleware
`requireAuth` / `requireAdmin` / `requireHistoryViewer` in `server/lib/auth.js`.

**Default seed:**
- E-mail: `tom@h20.gg`
- Naam: `Tom`
- Rol: `admin`
- Wachtwoord: zie `DEPLOY-SECRETS.local.md` (seed; na eerste login gewijzigd).

**Wachtwoord-opslag (productie):**
- bcrypt server-side (cost 12) in MySQL via de Express-backend; sessies als
  httpOnly cookie, same-origin. PINs worden eveneens met bcrypt gehasht.
- De migratie seedt admin `tom@h20.gg` met een bcrypt-hash en overschrijft een
  bestaand account niet (`server/scripts/migrate.js`).

**Schermen:**
1. `login.html` — e-mail + wachtwoord + "Wachtwoord vergeten?"-link.
2. `dashboard.html` — vereist sessie. Logout-knop rechtsboven.
3. `admin.html` — alleen voor admins. Tabel van users met: e-mail · naam · rol · acties (rol wijzigen, wachtwoord resetten, verwijderen). Knop *"Gebruiker toevoegen"*.

**Wachtwoord vergeten (admin-gestuurd):**
- Reset-tokens worden **alleen door een admin** gegenereerd via Beheer
  (`POST /api/auth/reset/request`, admin-only). Openstaande resets staan onder
  `GET /api/auth/resets`. De gebruiker consumeert het token via
  `POST /api/auth/reset/consume`. Er is bewust geen publieke self-service
  reset-flow (die lekte voorheen account-overname). Automatische e-mailverzending
  kan later toegevoegd worden.

**Gebruiker toevoegen / uitnodigen (admin):**
- Naam, e-mail, rol (`user`/`h20`/`admin`), via directe aanmaak of een uitnodiging.
- Account-aanmaak koppelt een PIN voor de tablet-check-in.

**Sessie:**
- Login zet een httpOnly sessie-cookie (server-side `sessions`-tabel); same-origin.
- Beveiligde pagina's checken de sessie via `GET /api/auth/me`; bij 401 → redirect
  naar login (centrale `h20:unauthorized`-afhandeling).
- Logout wist de sessie server-side + redirect.

**Veiligheid:**
- Server-side bcrypt (cost 12) voor wachtwoorden én PINs, httpOnly sessie-cookies,
  same-origin. Hash-kolommen verlaten nooit de server. De tablet-kiosk is bewust
  openbaar (werkt bij de deur zonder login); dashboard en Beheer vereisen een sessie.

---

## 4. Toast / Notificatie systeem

Centraal component. Eén notificatie tegelijk, max 6 sec zichtbaar.

**Varianten:**
| Type    | Kleur            | Wanneer                                            |
|---------|------------------|----------------------------------------------------|
| `error` | rood             | Conflict / niet mogelijk                           |
| `warn`  | oranje           | Maximaal mogelijk afgekapt (auto-corrigerend)      |
| `info`  | H20 magenta      | Bevestiging van actie ("Vergadering ingepland")    |
| `success` | groen          | Meeting gestart / verlengd                         |

**Standaard meldingsteksten:**
- *"Niet mogelijk om te verlengen — om {tijd} begint een geplande meeting ({titel}). Maximaal +{n} minuten beschikbaar."*
- *"Niet mogelijk om te starten — om {tijd} begint een geplande meeting. Kies een kortere duur."*
- *"Tijdslot bezet — er staat al een meeting van {start} tot {eind}."*
- *"Vergadering ingepland voor {datum} om {tijd}."*
- *"Vergadering verlengd tot {tijd}."*
- *"Vergadering beëindigd. Ruimte is weer beschikbaar."*

---

## 5. Data Model

### Per ruimte
```js
{
  id: 'raboroom',
  name: 'Raboroom',
  current: {                        // null als beschikbaar
    startedAt: ISO-string,
    busyUntil: ISO-string,
    title: string?,                 // optioneel
    email: string                   // verplicht — wie heeft geboekt
  },
  scheduled: [                      // array, gesorteerd op startAt
    {
      id: uuid,
      startAt: ISO-string,
      endAt: ISO-string,
      title: string?,
      email: string,                // verplicht
      createdAt: ISO-string
    }
  ]
}
```

### Constraints (validatie)
- `startAt < endAt`
- Geen overlap binnen `scheduled[]` van dezelfde ruimte
- Geen overlap met `current` indien actief
- Verleng-actie mag `current.busyUntil` niet voorbij eerstvolgende `scheduled[].startAt` brengen

---

## 6. Architectuur (productie, huidig)

```
[ tablet × 4 ] ──┐         ┌─────────────────────────────┐
[ dashboard  ] ──┼──fetch─►│ Express API (server/)        │
[ admin      ] ──┘         │  routes/rooms · routes/auth  │
[ login      ] ──┘         └──────────────┬──────────────┘
                                          └─► MySQL/MariaDB (InnoDB, utf8mb4)
```
- Hosting: Plesk + Phusion Passenger. Repo-root `app.js` = `require('./server/index.js')`.
  Webroot `public/` serveert de statische frontend; `/api` draait same-origin.
- Backend in `server/`: `index.js`, `db.js`, `lib/auth.js`, `routes/rooms.js`,
  `routes/auth.js`, `schema.sql`, `scripts/migrate.js`.
- De frontend draait volledig op de REST-API; `app.js`/`auth.js` doen async fetch
  (`getRoomStatus`, `startMeeting`, `extendMeeting`, `endMeeting`, `scheduleMeeting`,
  `cancelScheduled` + de `window.Auth`-functies). Envelope-vorm `{ok, reason?, data?}`.
- Conflict-logica (`canStart`/`canExtend`/`canSchedule`, overlap-checks) staat
  server-side in SQL zodat de business rules op één plek leven.
- Service Worker (`public/sw.js`) cachet statische assets offline; `/api` wordt
  nooit gecachet (`CACHE_VERSION` bumpen bij elke frontend-deploy).

---

## 7. Bestanden

Alle frontend-bestanden staan in `public/` (de webroot).

| Bestand                 | Rol                                                |
|-------------------------|----------------------------------------------------|
| `public/index.html`     | Portal / entry-pagina                              |
| `public/login.html`     | Inloggen + wachtwoord-reset (admin-gestuurd)       |
| `public/tablet.html`    | Tablet-kiosk — gekoppeld via `?room=...`           |
| `public/dashboard.html` | Centraal live overzicht                            |
| `public/admin.html`     | Beheer: gebruikers, uitnodigingen, historie, resets, kiosk |
| `public/styles.css`     | Design tokens, H20 branding, alle componenten      |
| `public/app.js`         | `window.H20` — rooms/meetings (async REST)         |
| `public/auth.js`        | `window.Auth` — login/gebruikers/PIN (async REST)  |
| `public/kiosk.js`       | Kiosk-bescherming (fullscreen, wake-lock, exit-PIN)|
| `public/sw.js`          | Service worker (offline cache; cachet `/api` niet) |
| `public/Logo H20 2026.png`| Officieel logo                                   |
| `app.js` (root)         | Passenger-entrypoint → `require('./server/index.js')` |
| `server/`               | Backend-API (Node + Express + MySQL)               |
| `server/README.md`      | Backend-setup, configuratie, migratie, endpoints   |
| `README.md`             | Snelstart + overzicht (NL)                         |
| `PROJECT_PLAN.md`       | Dit document — functionele scope + roadmap         |
| `DEPLOY.md`             | Deploy- en beheer-instructies                      |

---

## 8. Roadmap

### ✅ Fase 1 — Design Concept (klaar)
- [x] Tablet UI: beschikbaar/bezet
- [x] Reserveren: 30/60/90/anders
- [x] Verlengen: +15/+30/+60
- [x] Vergadering beëindigen (met bevestiging)
- [x] Centraal dashboard
- [x] Live klok, responsive design
- [x] H20 branding op donkere achtergrond
- [x] Plannen vooraf (datum + tijd + duur)
- [x] Conflict-bescherming bij verlengen/starten
- [x] Toast notificatie systeem
- [x] Verplichte e-mail bij reserveren met quick-domain pills
- [x] Geen tijdslimiet op duur of verlengen
- [x] Offline-mode op de tablet (service worker + action-queue)
- [x] Kiosk-bescherming (fullscreen lock, exit-PIN, anti-escape)
- [ ] ~~Philips Hue integratie~~ — geparkeerd, alleen op verzoek opnieuw inbouwen (zie 3.11)
- [x] Login-systeem voor dashboard (admin Tom + gebruikersbeheer + wachtwoord-reset)

### ✅ Fase 2 — Backend & Realtime (klaar, live)
- [x] Backend-stack: Node.js + Express + MySQL/MariaDB
- [x] MySQL-schema: `rooms`, `active_meetings`, `scheduled_meetings`, `meeting_history`, `users`, `sessions`, `invites`, `password_resets`, `pin_setups` (`server/schema.sql`)
- [x] Migratie + admin-seed met bcrypt (`server/scripts/migrate.js`)
- [x] REST-endpoints rooms/meetings + auth/gebruikers (`server/routes/`)
- [x] Server-side auth: bcrypt (wachtwoorden + PINs) + httpOnly sessie-cookies, same-origin
- [x] Rollen `admin` / `user` / `h20` (historie-inzage voor `h20`)
- [x] `app.js` / `auth.js` migreren van localStorage → fetch naar de API
- [x] Realtime: polling op de backend (later eventueel WebSockets)
- [x] Productie live op <https://meetings.h20.gg> (Plesk + Passenger)
- [ ] Audit-log uitbreiden (basis aanwezig: `meeting_history`)

### 🔮 Fase 3 — Integraties & Slimheid
- [ ] Outlook / Google Calendar two-way sync
- [ ] No-show detectie (geen check-in binnen 5 min → ruimte vrijgeven)
- [ ] QR-code check-in op tablet
- [ ] Analytics: bezettingsgraad per ruimte, piekuren
- [ ] Notificaties (Slack/e-mail) bij conflicten of vrijgekomen ruimtes

### 🚀 Fase 4 — Deploy & Beheer
- [ ] Kiosk-mode op fysieke tablets (Android Fully Kiosk Browser of iPad guided access)
- [ ] Auto-update strategie (PWA cache)
- [ ] Monitoring (Uptime + foutlog naar Sentry of vergelijkbaar)
- [ ] Backup-procedure database
- [ ] Documentatie voor onboarding nieuwe medewerkers

---

## 9. Technische keuzes & rationale

| Keuze                          | Rationale                                                                 |
|--------------------------------|---------------------------------------------------------------------------|
| Vanilla HTML/CSS/JS (geen build)| Geen build-step, geen framework lock-in. Statische frontend uit `public/`. |
| Node + Express + MySQL/MariaDB | Express op Plesk/Passenger; centrale DB als bron van waarheid voor alle schermen. |
| bcrypt server-side             | Vervangt client-side SHA-256; salt zit in de hash, geen plaintext.        |
| H20 magenta + donkere UI       | Past bij gaming/esports merk. Sterk contrast op ieder scherm.             |
| URL-parameter voor room-id     | Hardcoded koppeling zonder build-step. Per tablet één bookmark.           |
| Inter font                     | Open source, leesbaar op afstand, gratis via Google Fonts.                |

---

## 10. Risico's & open vragen

1. **Welke tablets?** Android of iPad? Bepaalt kiosk-strategie.
2. **Netwerk**: alle tablets op WiFi? Backup-gedrag bij offline?
3. **Tijd-synchronisatie**: alle tablets moeten dezelfde tijd hebben → NTP afdwingen.
4. **Authenticatie**: de tablet-kiosk is bewust openbaar (werkt bij de deur); dashboard + Beheer vereisen een sessie. Open vraag: willen we plannen óók achter login zetten?
5. **Privacy**: titels van meetings zichtbaar voor iedereen op het dashboard? Optie om "privé" aan te vinken?
6. **Outlook-integratie**: wel/niet nodig? Vergt extra fase + Microsoft Graph API setup.

---

## 11. Hosting & Overdracht

### Lokaal draaien (dev)
```bash
sudo service mariadb start          # lokale database (eenmalig per boot)
cd server && node dev-local.js      # frontend + /api same-origin op poort 8080
# http://localhost:8080/login.html
```
`dev-local.js` is dev-only en `.gitignore`'d. Details: `server/README.md`.

### Productie (live)
- Plesk + Phusion Passenger op <https://meetings.h20.gg>.
- App-root `~/meetings.h20.gg`, webroot `~/meetings.h20.gg/public`, entrypoint
  `app.js` (`require('./server/index.js')`), Node 24.
- Deploy = `git pull` → eventueel `npm install --omit=dev` / migratie →
  `touch tmp/restart.txt`. Volledige stappen + troubleshooting: `DEPLOY.md`.

---

## 12. Volgende stappen

Fase 1 & 2 zijn live. Resterend:
1. **Fase 3** — Outlook/Google Calendar two-way sync, no-show detectie, analytics.
2. **Fase 4** — fysieke tablet-rollout in kiosk-mode (Android Fully Kiosk Browser
   of iPad guided access), monitoring + backup-procedure.
3. Beslissingen op de open vragen (sectie 10), m.n. privacy van meeting-titels.
