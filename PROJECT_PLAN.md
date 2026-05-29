# Meetingrooms H20 — Project Plan

> **Status**: ✅ Fase 1 voltooid · 🔨 Fase 2 gestart — backend-scaffold (Node + Express + MySQL) staat in `server/`
> **Volgende stap**: Frontend koppelen aan de backend-API; daarna fysieke tablet-rollout
> **Locatie code**: `/home/tom/Desktop/Claude/Meetingroom Project` (backend in `server/`)
> **Naam vs. domein**: app heet **Meetingrooms H20**; `Meetings@h20.gg` is het e-maildomein
> **Eigenaar**: Tom · H20 Esports Campus Amsterdam
> **Laatst bijgewerkt**: 2026-05-29

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
| `aquarium` | Aquarium    | Glazen ruimte · 1e verdieping    |
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
- **Demo (huidig)**: cross-tab `localStorage` events
- **Productie (fase 2)**: polling op de MySQL-backend, later eventueel WebSockets

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
- (Fase 2: e-mail kan ook gebruikt worden voor reminders / no-show pings.)

### 3.8 Geen tijdslimiet

Een ruimte mag voor onbeperkte tijd geboekt worden:
- Geen maximum op `Anders` duur (was 480 min, nu onbeperkt).
- Geen maximum op verlengen — `+60` mag herhaald geklikt worden tot 3, 5, 10 uur.
- Bij plannen: geen maximum op duur per slot.
- **Enige rem**: de conflict-check tegen volgende geplande meeting (zie 3.6).

Praktisch: de input accepteert iedere positieve waarde ≥ 5 minuten. Op het scherm wordt lange duur netjes weergegeven (`tot 14:30 morgen` als het over middernacht heen gaat — fase 2 verbetering).

### 3.9 Offline-mode (kritiek voor productie)

De tablet bij de deur mag **nooit** offline een witte pagina tonen. WiFi valt incidenteel weg op de campus en het systeem moet daar tegen kunnen.

**Aanpak:**
- **Service Worker** (`sw.js`) cachet alle statische assets (HTML/CSS/JS/logo/font) bij eerste bezoek.
- **State**: laatste bekende status van de ruimte staat in `localStorage` — blijft beschikbaar zonder netwerk.
- **Offline indicator**: subtiele pill rechtsboven *"Offline — werkt nog door"*.
- **Action queue**: starten/verlengen/beëindigen tijdens offline wordt in `localStorage` queue gezet (`h20-pending-actions`). Bij online-event spoelt de queue richting de server (fase 2) of merged direct in lokale state (fase 1).
- **Reconnect-detectie**: `navigator.onLine` + `online`/`offline` events + heartbeat-ping naar `/healthz` elke 30 sec (fase 2). Bij reconnect: toast *"Weer online — wijzigingen gesynchroniseerd."*
- **Conflict-resolutie bij sync** (fase 2): server is source of truth; bij overlap krijgt eerst geboekt voorrang en wordt de offline-poging gemarkeerd als geweigerd met heldere uitleg.

**Fase 1 (huidig)**:
- SW geïnstalleerd + cache-first strategie voor assets.
- Pending-queue UI zichtbaar maar geen echte server-sync (geen backend).
- Manual "Sync nu"-knop op het tablet-debug-scherm (lang ingedrukt logo) voor demo.

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
| `admin` | Alles. Gebruikers/admins beheren, Hue/kiosk configureren, alle meetings annuleren, exit-PIN wijzigen. |
| `user`  | Dashboard bekijken, alleen eigen geplande meetings annuleren.       |

**Default seed:**
- E-mail: `tom@h20.gg`
- Naam: `Tom`
- Rol: `admin`
- Wachtwoord: `H20esports@`

**Wachtwoord-opslag:**
- **Fase 1 (demo)**: SHA-256 hash via `window.crypto.subtle` + per-user salt, opgeslagen in `localStorage` key `h20-users`. Géén plaintext.
- **Fase 2 (productie)**: bcrypt server-side (cost 12) in MySQL via de Express-backend; sessies als httpOnly cookie. De migratie seedt admin `tom@h20.gg` opnieuw met een bcrypt-hash (`server/scripts/migrate.js`).

**Schermen:**
1. `login.html` — e-mail + wachtwoord + "Wachtwoord vergeten?"-link.
2. `dashboard.html` — vereist sessie. Logout-knop rechtsboven.
3. `admin.html` — alleen voor admins. Tabel van users met: e-mail · naam · rol · acties (rol wijzigen, wachtwoord resetten, verwijderen). Knop *"Gebruiker toevoegen"*.

**Wachtwoord vergeten:**
- Gebruiker vult e-mail in op `login.html`.
- App genereert reset-token (random 6-cijferig), slaat tijdelijk op in localStorage (TTL 30 min).
- **Demo (fase 1)**: opent `mailto:admin-mail?subject=Wachtwoord reset H20 Meetingroom&body=Reset-token: 123456 …` zodat de gebruiker dat zelf naar de admin stuurt. Admin kan in admin-panel het token verifiëren en een nieuw wachtwoord instellen.
- **Productie (fase 2)**: backend genereert een reset-token (`POST /api/auth/reset/request`) en de admin deelt de link/code; consumeren via `POST /api/auth/reset/consume`. Automatische e-mailverzending kan later toegevoegd worden.

**Gebruiker toevoegen (admin):**
- Naam, e-mail, rol (`user`/`admin`), tijdelijk wachtwoord.
- Optie *"E-mail welkomstbericht openen"* — opent `mailto:` met klaargezet bericht + tijdelijk wachtwoord.
- Bij eerste login moet de gebruiker het wachtwoord wijzigen (fase 2).

**Sessie:**
- Login zet `h20-session` key in `localStorage` met `{userId, expiresAt}` — default TTL 7 dagen.
- `auth.requireLogin()` aan het begin van dashboard/admin → redirect naar login bij ongeldig.
- Logout wist sessie + redirect.

**Veiligheid (eerlijk in fase 1):**
- Dit is **demo-auth** in de browser. Iemand die `localStorage` opent kan hashes lezen en met genoeg kennis een sessie vervalsen. Het is goed genoeg om medewerkers te scheiden van bezoekers en om Matthijs te laten zien hoe het zou werken. **Productie-auth komt in fase 2 met server-side bcrypt + httpOnly sessie-cookies (Express-backend).** Dit staat ook duidelijk in de login-pagina.

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

## 6. Architectuur

### Fase 1 (huidig)
```
[ tablet.html ] ── localStorage ──┐
[ tablet.html ] ── localStorage ──┼─► gedeelde mock-store (app.js)
[ tablet.html ] ── localStorage ──┤
[ dashboard.html ] ── localStorage ┘
```
- Cross-tab events simuleren realtime sync.
- Geen server, geen build, geen dependencies.

### Fase 2 (productie)
```
[ tablet × 4 ] ──┐         ┌─────────────────────────────┐
[ dashboard  ] ──┼──fetch─►│ Express API (server/)        │
[ admin      ] ──┘         │  routes/rooms · routes/auth  │
                           └──────────────┬──────────────┘
                                          └─► MySQL (InnoDB, utf8mb4)
```
- Backend-scaffold staat in `server/`: `index.js`, `db.js`, `lib/auth.js`, `routes/rooms.js`, `routes/auth.js`, `schema.sql`, `scripts/migrate.js`.
- Endpoints retourneren dezelfde envelope-vorm als de huidige frontend-returnwaarden, zodat `app.js`/`auth.js` per functie 1-op-1 gekoppeld kunnen worden (`getRoomStatus`, `startMeeting`, `extendMeeting`, `endMeeting`, `scheduleMeeting`, `cancelScheduled`, plus de `window.Auth`-functies).
- Conflict-logica (`canStart`/`canExtend`/`canSchedule`, overlap-checks) is server-side geport naar SQL zodat de business rules behouden blijven.
- MySQL draait op een externe server; verbinden kan direct of via SSH-tunnel (zie `server/README.md`).

---

## 7. Bestanden

| Bestand            | Rol                                                |
|--------------------|----------------------------------------------------|
| `index.html`       | Showcase / pitch-pagina (presentatie aan Matthijs) |
| `tablet.html`      | Tablet kiosk — gekoppeld via `?room=...`           |
| `dashboard.html`   | Centraal live overzicht                            |
| `styles.css`       | Design tokens, H20 branding, alle componenten      |
| `app.js`           | State, helpers, mock-store, realtime API           |
| `auth.js`          | Login + gebruikersbeheer (localStorage, fase 1)    |
| `Logo H20 2026.png`| Officieel logo                                     |
| `README.md`        | Snelstart-instructies (NL)                         |
| `PROJECT_PLAN.md`  | Dit document — volledige project-roadmap          |
| `server/`          | Backend-API (Node + Express + MySQL) — fase 2      |
| `server/README.md` | Backend-setup, SSH-tunnel, migratie, smoke-tests   |

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

### 🔨 Fase 2 — Backend & Realtime
- [x] Backend-stack gekozen: Node.js + Express + MySQL (i.p.v. Supabase)
- [x] MySQL-schema: `rooms`, `active_meetings`, `scheduled_meetings`, `meeting_history`, `users`, `sessions`, `invites`, `password_resets`, `pin_setups` (`server/schema.sql`)
- [x] Migratie + admin-seed met bcrypt (`server/scripts/migrate.js`)
- [x] REST-endpoints rooms/meetings + auth/gebruikers (`server/routes/`)
- [x] Server-side auth: bcrypt + httpOnly sessie-cookies, CORS beperkt tot frontend-origin
- [ ] MySQL koppelen op externe server (Johan) + migratie draaien
- [ ] `app.js` / `auth.js` migreren van localStorage → fetch naar de API
- [ ] Realtime: polling op de backend (later eventueel WebSockets)
- [ ] Audit-log uitbreiden (basis: `meeting_history`)

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
| Statisch HTML/CSS/JS in fase 1 | Geen build, geen npm. Dubbelklik = werkt. Snel prototype voor pitch.      |
| Vanilla JS                     | Geen framework lock-in. Hele codebase blijft <1000 regels en leesbaar.    |
| Node + Express + MySQL (fase 2)| MySQL draait op de server van Johan; Express spiegelt het bestaande API-oppervlak 1-op-1. |
| bcrypt server-side             | Vervangt client-side SHA-256; salt zit in de hash, geen plaintext.        |
| H20 magenta + donkere UI       | Past bij gaming/esports merk. Sterk contrast op ieder scherm.             |
| URL-parameter voor room-id     | Hardcoded koppeling zonder build-step. Per tablet één bookmark.           |
| Inter font                     | Open source, leesbaar op afstand, gratis via Google Fonts.                |

---

## 10. Risico's & open vragen

1. **Welke tablets?** Android of iPad? Bepaalt kiosk-strategie.
2. **Netwerk**: alle tablets op WiFi? Backup-gedrag bij offline?
3. **Tijd-synchronisatie**: alle tablets moeten dezelfde tijd hebben → NTP afdwingen.
4. **Authenticatie**: mag iedereen alles plannen? Of alleen ingelogde medewerkers? (Fase 2 beslissing)
5. **Privacy**: titels van meetings zichtbaar voor iedereen op het dashboard? Optie om "privé" aan te vinken?
6. **Outlook-integratie**: wel/niet nodig? Vergt extra fase + Microsoft Graph API setup.

---

## 11. Hosting & Overdracht

### Lokaal draaien
```bash
cd "/home/tom/Desktop/Claude/Meetingroom Project"
python3 -m http.server 8080
# http://localhost:8080/
```

### Naar productie (fase 1, statisch)
- **Optie A**: Netlify drop — sleep de map naar netlify.com → URL klaar.
- **Optie B**: Eigen Nginx/Caddy op interne H20 server.
- **Optie C**: GitHub Pages.

### Naar productie (fase 2, met MySQL-backend)
- Frontend: zelfde als hierboven (statisch).
- Backend: Node-proces uit `server/` tegen MySQL op de server van Johan. Setup, SSH-tunnel en migratie staan in `server/README.md`. Process-manager (pm2/systemd) volgt later.

---

## 12. Contact & Volgende stap

Fase 2 is gestart — de backend-scaffold staat klaar. Resterende stappen:
1. MySQL-toegang van Johan ontvangen; `.env` invullen (of via SSH-tunnel).
2. `npm run migrate` draaien → schema + admin-seed.
3. `app.js` / `auth.js` migreren van localStorage naar fetch — geschat 4-6 uur omdat de API al bestaat en de envelope-vorm matcht.
4. Beslissingen op de open vragen (sectie 10).
5. Tablets bestellen + kiosk-config.
6. Pilot in één ruimte (Raboroom), daarna uitrol naar alle vier.

**Geschat tijdspad fase 2**: 1-2 weken parttime.
