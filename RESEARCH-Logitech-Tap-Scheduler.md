---
title: Logitech Tap Scheduler — functie-analyse voor Meetingrooms H20
date: 2026-11-06
---

# Logitech Tap Scheduler — wat kunnen wij overnemen

Onderzoek naar de Logitech Tap Scheduler + de bijbehorende software
(Logitech Room Booking / Sync) en de relevante Google Workspace-functies.
Doel: een lijst met functies die wij in **Meetingrooms H20** kunnen gebruiken.

Scope-afbakening: H20 draait volledig op **Google Workspace / Google Agenda**.
Alles wat Teams-, Zoom- of CollabOS-specifiek is, is hier bewust weggelaten.
Ook de pure hardware-eigenschappen (PoE, accelerometer, mounting-kits) zijn
alleen meegenomen waar ze een gedragsregel impliceren die wij in software of
in de tablet-rollout kunnen nabootsen.

Bronnen staan onderaan.

---

## 1. Wat de Tap Scheduler feitelijk is

Een 10.1" touchscreen-paneel naast de deur, PoE-gevoed, met een LED-balk die
van afstand groen/rood toont. De software erachter (Logitech Room Booking)
koppelt via een service-account aan Google Workspace-agenda's en zet de
room resources van Google Calendar op het paneel. Beheer en policies lopen
via een centrale cloud-console (Sync).

Qua opzet is dat exact ons model: tablet bij de deur + centraal beheer.
Het verschil zit in de volwassenheid van de boekingslogica, de statusweergave
en het vlootbeheer.

---

## 2. Functies die wij kunnen overnemen

Per functie: wat Logitech doet, en wat dat concreet voor ons betekent.
Status geeft aan of we het al hebben.

### A. Agenda-integratie

| # | Functie | Wat het is | Status bij ons |
|---|---|---|---|
| A1 | **Two-way sync met Google Agenda** | Rooms zijn Google Calendar *resources*. Boeken kan vanuit de agenda-uitnodiging én vanaf het paneel; beide kanten updaten binnen seconden. | Nog niet (staat als fase 3) |
| A2 | **Boeken vanuit de uitnodiging** | Medewerker voegt de ruimte toe als resource in een normale agenda-afspraak. Geen aparte tool openen. | Nog niet — dit is de belangrijkste adoptie-winst |
| A3 | **Resource-model per ruimte** | Elke ruimte is een eigen agenda met eigen capaciteit, verdieping, features. | Deels — wij hebben `rooms`, maar geen capaciteit/kenmerken |
| A4 | **Conflicten worden door de agenda afgevangen** | Dubbelboekingen bestaan niet omdat de agenda de bron van waarheid is. | Wij doen dit zelf server-side in SQL — bij sync moet één kant leidend worden |

> **Let op bij A1**: two-way sync is de grootste architectuurbeslissing in dit
> hele lijstje. Of Google Agenda wordt de bron van waarheid en onze DB is een
> cache, of andersom. Half-half geeft gegarandeerd spookboekingen.

### B. Statusweergave en zichtbaarheid van afstand

| # | Functie | Wat het is | Status bij ons |
|---|---|---|---|
| B1 | **Kleurcodering van afstand zichtbaar** | LED-balk onder het scherm: groen = vrij, rood = bezet. Je ziet het vanaf de gang, zonder het scherm te lezen. | Nog niet fysiek — wel een idee (Hue-plan is geparkeerd) |
| B2 | **Volledig scherm als kleurvlak** | Het hele paneel kleurt mee, niet alleen een badge. Leesbaar vanaf ~5 meter. | Ja — tablet gebruikt al groen/rood schermstaat |
| B3 | **Statuswissel-interval instelbaar (1–5 min)** | Hoeveel minuten vóór het einde de status al omslaat naar "bijna vrij / bijna bezet". | Nog niet — eenvoudige toevoeging |
| B4 | **Ambient light sensor → helderheid aanpassen** | Scherm dimt 's avonds, fel overdag. | OS-niveau op de tablet; wel een item voor de rollout |
| B5 | **Agenda van de dag op het paneel** | Niet alleen "bezet tot X", maar de volledige dagrij met komende blokken. | Deels — dashboard heeft het, tablet niet volledig |

### C. Boeken en beheren op het paneel zelf

| # | Functie | Wat het is | Status bij ons |
|---|---|---|---|
| C1 | **Ad-hoc boeken met één tik** | Vrije ruimte? Tik en hij is van jou. | Ja (30/60/90/Anders) |
| C2 | **Verlengen vanaf het paneel** | Lopende meeting verlengen zonder agenda te openen. | Ja (+15/+30/+60) |
| C3 | **Vroegtijdig beëindigen** | Ruimte direct vrijgeven als je klaar bent. | Ja |
| C4 | **Wijzigen vanaf het paneel** | Niet alleen verlengen/stoppen maar ook de boeking aanpassen (titel, eindtijd). | Nog niet |
| C5 | **"Volgende vrije moment" tonen** | Bij een bezette ruimte meteen tonen wanneer hij weer vrij is. | Deels op dashboard, niet prominent op tablet |

### D. No-show bestrijding — de grootste praktische winst

Dit is waar room-panels hun geld verdienen. Logitech en Google claimen allebei
dat een substantieel deel van de geboekte ruimtes nooit gebruikt wordt
(Google noemde in hun eigen onderzoek tot 40%).

| # | Functie | Wat het is | Status bij ons |
|---|---|---|---|
| D1 | **Verplichte check-in** | De boeking moet binnen X minuten na starttijd bevestigd worden op het paneel. | Nog niet (wel op de roadmap) |
| D2 | **Auto-release bij geen check-in** | Geen check-in binnen de marge → boeking vervalt, ruimte wordt weer groen. | Nog niet |
| D3 | **Check-in marge instelbaar** | Logitech laat de admin de timing kiezen; Google hanteert standaard 10 min. | Nog niet |
| D4 | **Auto-release bij leegstand tijdens de meeting** | Bij Logitech via camera-aanwezigheidsdetectie: niemand in de ruimte → vrijgeven. | Niet realistisch zonder sensor — zie alternatief hieronder |
| D5 | **Auto-book bij spontaan gebruik** | Iemand loopt een lege ruimte binnen → ruimte wordt automatisch geboekt. | Niet zonder sensor |

**Alternatief voor D4/D5 zonder camera's:** een goedkope PIR- of
mmWave-aanwezigheidssensor per ruimte (ESP32 + Home Assistant of direct een
webhook naar onze API) geeft 80% van hetzelfde effect voor een fractie van de
kosten. Dat past ook bij de bestaande campus-infrastructuur.

### E. Privacy

| # | Functie | Wat het is | Status bij ons |
|---|---|---|---|
| E1 | **Meeting-titels verbergen** | Admin-toggle: toon alleen "Bezet" in plaats van "Sollicitatiegesprek Jan de Vries". | Nog niet — staat als open vraag in het plan (sectie 10.5) |
| E2 | **Organisator wel/niet tonen** | Aparte schakelaar voor de naam van de boeker. | Nog niet — wij tonen nu altijd het e-mailadres |
| E3 | **Per-afspraak privé-vlag** | De boeker kan één specifieke meeting als privé markeren. | Nog niet |
| E4 | **Geen audio/video/content verwerking** | Het paneel registreert alleen boekingsdata. | Ja, geldt automatisch voor ons |

> E1 t/m E3 zijn voor H20 relevanter dan ze lijken: het dashboard is campus-breed
> zichtbaar en er zitten huurders en externe partijen in het pand.

### F. Beheer en vlootbeheer

| # | Functie | Wat het is | Status bij ons |
|---|---|---|---|
| F1 | **Centrale device-inventaris** | Overzicht van alle panelen, online/offline, firmwareversie. | Nog niet — wij hebben geen zicht op of een tablet nog leeft |
| F2 | **Offline-notificatie** | Alert als een paneel wegvalt. | Nog niet — hoge waarde, lage kosten |
| F3 | **Remote UI-toegang** | Op afstand meekijken op wat het paneel toont. | Nog niet — screenshot-endpoint of remote-refresh is haalbaar |
| F4 | **Centrale policy-instellingen** | Check-in-timing, privacy, kleuren: één plek, geldt voor alle panelen. | Deels — admin-paneel heeft kiosk-instellingen, maar niet per-ruimte policies |
| F5 | **Remote software-update** | Panelen updaten zichzelf centraal. | Deels — service worker cache-bump doet dit feitelijk al |
| F6 | **Custom branding / achtergrond** | Eigen wallpaper, kleuren en randkleur per ruimte instelbaar. | Deels — H20-branding staat vast, niet configureerbaar |

### G. Analytics

| # | Functie | Wat het is | Status bij ons |
|---|---|---|---|
| G1 | **Bezettingsgraad per ruimte** | Welke ruimtes worden over- en ondergebruikt. | Nog niet — data zit al in `meeting_history` |
| G2 | **Piekuren / heatmap** | Wanneer is het druk. | Nog niet |
| G3 | **No-show rapportage** | Hoeveel boekingen zijn nooit ingecheckt, en door wie. | Nog niet — vereist eerst D1 |
| G4 | **"Hoeveel uur zou auto-release opleveren"** | Google's room insights rekent dit expliciet voor. | Nog niet — sterk argument richting directie |
| G5 | **Export** | Rapport eruit trekken voor facturatie of verantwoording. | Ja — `h20`-rol kan historie exporteren |

### H. Wayfinding en bredere campus-functies

| # | Functie | Wat het is | Status bij ons |
|---|---|---|---|
| H1 | **Interactieve plattegrond** | Zoek een vrije ruimte op een kaart van het pand. | Nog niet — bij 4 ruimtes beperkte waarde |
| H2 | **Mobiele app / mobiel zicht** | Zie beschikbaarheid en boek vanaf je telefoon. | Deels — dashboard is responsive, maar geen echte mobiele flow |
| H3 | **Points of interest** | Toiletten, lift, café op de kaart. | Niet relevant nu |

### I. Hardware-gedrag dat wij in de rollout moeten nabootsen

| # | Functie | Wat het is | Status bij ons |
|---|---|---|---|
| I1 | **PoE — één kabel voor stroom en netwerk** | Geen stekkerdoos naast de deur, geen tablet die leeg loopt. | Rollout-beslissing — PoE-tablet of PoE-splitter overwegen |
| I2 | **Altijd-aan scherm** | Paneel gaat nooit in slaapstand. | Ja — wake-lock in `kiosk.js` |
| I3 | **Vaste montage, geen losse tablet** | Niet mee te nemen, niet te verdraaien. | Rollout-beslissing |
| I4 | **Volledige schijfversleuteling** | Apparaat bij de deur is fysiek benaderbaar. | Rollout-beslissing — tablet-encryptie aanzetten |
| I5 | **Automatisch herstellen na stroomuitval** | Boot direct terug in de app. | Deels — auto-reboot cron staat in het plan, boot-to-app moet in de kiosk-browser |

---

## 3. Prioritering voor H20

Gesorteerd op waarde gedeeld door inspanning.

### Nu doen — hoge waarde, beperkte bouw
1. **D1 + D2 + D3 — check-in met auto-release.** Dit lost het echte probleem op:
   geblokkeerde ruimtes die leeg staan. Puur backend + een knop op de tablet.
2. **E1 + E2 — privacy-toggles voor titel en boeker.** Eén admin-instelling,
   lost een openstaande vraag uit het projectplan op en is nodig zolang er
   externen in het pand zijn.
3. **F2 — offline-alert per tablet.** Een heartbeat van elke tablet naar de API
   plus een melding als er 10 minuten niets binnenkomt. Klein werk, voorkomt
   dat een dood scherm dagen onopgemerkt blijft.
4. **B3 + C5 — "bijna vrij / bijna bezet" en het eerstvolgende vrije moment**
   prominent op de tablet. Puur frontend.
5. **G1 + G2 — basis-analytics uit `meeting_history`.** De data ligt er al.

### Daarna — groot, maar dit is de echte sprong
6. **A1 + A2 — Google Agenda two-way sync.** Zodra de ruimtes echte Google
   Calendar resources zijn, boekt iedereen gewoon vanuit zijn eigen agenda en
   wordt het systeem pas echt gebruikt. Vereist een Workspace-service-account
   met domain-wide delegation en een duidelijke keuze over de bron van waarheid.
7. **G3 + G4 — no-show rapportage inclusief "dit levert auto-release op".**
   Volgt logisch na punt 1 en 6.

### Overwegen
8. **D4/D5 via goedkope aanwezigheidssensoren** in plaats van camera's.
9. **B1 — fysieke LED of lamp bij de deur.** Het geparkeerde Hue-plan is
   precies dit. Logitech bewijst dat de waarde zit in "zien zonder lezen".
10. **F6 — per ruimte configureerbare achtergrond/accentkleur.**

### Niet doen
- Alles wat Teams/Zoom/CollabOS-specifiek is.
- **H1/H3 — plattegronden en wayfinding.** Bij 4 ruimtes op één verdieping
  lost dat een probleem op dat we niet hebben.

---

## 4. Wat Logitech beter doet dan wij, in één zin per punt

- De agenda is de bron van waarheid, niet het paneel — wij hebben nu een
  los eilandje naast Google Agenda.
- Een boeking die niet wordt ingecheckt, verdwijnt vanzelf.
- Status is zichtbaar zonder dat je het scherm hoeft te lezen.
- De beheerder ziet centraal of elk paneel nog leeft.
- Privacy is een instelling, geen aanname.

## 5. Wat wij beter doen dan Logitech

- Geen licentiekosten per ruimte per jaar.
- Geen hardware-lock-in: elke tablet met een browser werkt.
- Conflict-bescherming bij verlengen met een concrete tegensuggestie
  ("wel +12 min verlengen") — dat is verfijnder dan een harde blokkade.
- Volledige controle over de branding en de data; niets gaat naar een cloud
  van een leverancier.

---

## Bronnen

- [Logitech Tap Scheduler — productpagina (NL)](https://www.logitech.com/nl-nl/products/video-conferencing/room-solutions/tap-scheduler.952-000091.html)
- [Logitech Room Booking — oplossingspagina](https://www.logitech.com/en-us/products/video-conferencing/solutions/roombooking.html)
- [Logitech Sync Hub — Enable simplified room scheduling with Logitech Room Booking](https://hub.sync.logitech.com/learn/post/enable-simplified-room-scheduling-with-logitech-room-booking-LGsxgGNByTTeQFg)
- [Logitech Tap Scheduler — datasheet (PDF)](https://www.logitech.com/content/dam/logitech/en/video-collaboration/pdf/tap-scheduler-datasheet.pdf)
- [Google Workspace Updates — automatic room release en room insights](https://workspaceupdates.googleblog.com/2018/08/manage-meeting-rooms-efficiently.html)
- [Smart Workplace Guide — Logitech Tap Scheduler review 2026](https://smartworkplaceguide.com/reviews/logitech-tap-scheduler-review-2026-room-panel-for-teams/)
