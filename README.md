# Meetingrooms H20

Tablet-gebaseerd reserveringssysteem voor de 4 meetingrooms van H20 Esports Campus Amsterdam (Aquarium, Bundled, Lounge Café, Raboroom). Centraal dashboard, gebruikersbeheer, kiosk-bescherming en offline-mode. `Meetings@h20.gg` is het e-maildomein; de app heet **Meetingrooms H20**.

Statische frontend — geen build, geen dependencies. Te hosten op iedere webserver. State staat nu nog in `localStorage`. In fase 2 wordt dit zonder API-wijziging vervangen door een **Node.js + Express + MySQL** backend (zie `server/`); de frontend-koppeling volgt later.

## Inhoud

| Bestand | Doel |
|---|---|
| `index.html` | Portal — entry-pagina met links naar tablets, dashboard en beheer |
| `tablet.html` | Tablet-kiosk interface (per ruimte) |
| `dashboard.html` | Centraal online dashboard (alle 4 ruimtes) |
| `styles.css` | Gedeelde styling, design tokens, H20 branding |
| `app.js` | Demo-logica (mock state, klok, meeting starten/verlengen) |
| `auth.js` | Login + gebruikersbeheer (SHA-256, localStorage, fase 2 → backend bcrypt) |
| `kiosk.js` | Kiosk-bescherming voor tablets (fullscreen, wake-lock, anti-escape, exit-PIN) |
| `sw.js` | Service Worker — offline cache zodat de tablet blijft werken zonder netwerk |
| `login.html` | Inlogpagina + wachtwoord-reset (6-cijferige code) |
| `admin.html` | Beheerpaneel: gebruikers, Kiosk config |
| `Logo H20 2026.png` | Officieel H20 logo |
| `server/` | Backend-API (Node + Express + MySQL) — fase 2, draait los van de frontend |

## Admin login (demo)

- **E-mail:** `tom@h20.gg`
- **Wachtwoord:** `H20esports@`

Wachtwoord wijzigen en nieuwe gebruikers/admins toevoegen kan via `admin.html`.

## Hoe gebruiken

### Lokaal bekijken
Dubbelklik `index.html` — opent direct in de browser. Geen build, geen install.

Of via een lokale server (aanbevolen voor de tablet kiosk-mode):
```bash
cd "/home/tom/Desktop/Claude/Meetingroom Project"
python3 -m http.server 8080
```
Daarna openen: <http://localhost:8080/>

### URLs
- **Showcase / pitch**: `index.html`
- **Tablet Aquarium**: `tablet.html?room=aquarium`
- **Tablet Bundled**: `tablet.html?room=bundled`
- **Tablet Lounge Café**: `tablet.html?room=lounge`
- **Tablet Raboroom**: `tablet.html?room=raboroom`
- **Centraal dashboard**: `dashboard.html`

Iedere tablet is hardcoded gekoppeld aan **één** ruimte via de URL-parameter.
Geen dropdown of switcher — exact zoals vereist.

## De 4 meetingrooms
1. **Aquarium**
2. **Bundled**
3. **Lounge Café**
4. **Raboroom**

## Design principes
- **Branding**: H20 magenta (#E6175C) als primaire accent, donkere oppervlakken voor het dashboard.
- **Status-kleuren**: helder groen (beschikbaar) en helder rood (bezet) vullen het hele tablet-scherm — zichtbaar vanaf de gang.
- **Touch-first**: knoppen zijn minimaal 96px hoog, ruime witruimte, geen kleine controls.
- **Zero-learning**: één blik = status duidelijk. Geen menu's, geen instellingen op de tablet.
- **Realtime-klaar**: de architectuur (gedeelde mock store in `app.js`) is identiek aan een latere backend/websocket-integratie — alleen de transport-laag verandert.

## Roadmap naar productie (fase 2+)
1. Backend: **Node.js + Express + MySQL** — scaffold staat in `server/` (zie `server/README.md`). MySQL draait op een externe server.
2. `app.js` / `auth.js` koppelen aan de API (van synchroon localStorage naar async fetch).
3. Auth voor het dashboard (medewerker login) — server-side bcrypt + sessie-cookies.
4. Outlook/Google Calendar sync.
5. Kiosk-mode deploy op tablets (Android Fully Kiosk Browser of vergelijkbaar).

## Doorzetten naar een server
De frontend is puur statisch:
- Upload de hele map naar elke webhost (Netlify, Vercel, eigen Nginx, S3+CloudFront).
- Of: zet `python3 -m http.server` / `nginx` op een interne machine in het netwerk.

De backend (`server/`) draait apart als Node-proces tegen MySQL — setup en SSH-tunnel-instructies staan in `server/README.md`.

## Status van dit concept
- [x] Tablet "Beschikbaar" scherm
- [x] Tablet "Bezet" scherm
- [x] Tijd kiezen (30/60/90/Anders)
- [x] Custom tijd via "Anders"
- [x] Meeting verlengen (+15/+30/+60)
- [x] Centraal dashboard met alle 4 ruimtes
- [x] Live klok
- [x] H20 branding met logo
- [x] Responsive (desktop + tablet liggend/staand)
- [x] Backend-scaffold (Node + Express + MySQL) in `server/` — fase 2
- [ ] Frontend koppelen aan de backend-API — fase 2 vervolgstap
