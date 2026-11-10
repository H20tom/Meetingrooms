---
title: Meetingrooms H20 — Fase 3 implementatieplan
date: 2026-11-06
---

# Fase 3 — implementatieplan

Vijf features, uitgewerkt na de Logitech-analyse in
[RESEARCH-Logitech-Tap-Scheduler.md](RESEARCH-Logitech-Tap-Scheduler.md).

H20 draait volledig op Google Workspace. Alles wat Teams-, Zoom- of
CollabOS-specifiek is, is buiten beschouwing gelaten.

---

## 0. Drie gedeelde bouwstenen — eerst bouwen

Vier van de vijf features leunen hierop. Los bouwen voorkomt dat elke feature
zijn eigen variant krijgt.

**A. `app_settings`** — centrale key/value-configuratie. Check-in-marge,
alert-drempel, alert-venster, exit-PIN-hash. Nu staat kiosk-config per tablet in
`localStorage`; dat schaalt niet naar beleid dat voor alle tablets geldt.

**B. `server/scripts/tick.js`** — één Plesk Scheduled Task, elke minuut.

**C. `server/lib/notify.js`** — Slack-notifier met deduplicatie.

### Waarom een cron en geen setInterval

| Mechanisme | Oordeel |
|---|---|
| `setInterval` in de app | Afgewezen. Passenger stopt idle processen (default na 300s) en kan er meerdere starten. De timer stopt dus precies op rustige momenten, of draait dubbel. |
| Alleen lazy evaluatie in `computeStatus()` | Noodzakelijk maar niet voldoende. Werkt zolang iemand kijkt. Twee gaten: staan alle schermen uit, dan loopt de historie achter en houdt Hue de verkeerde kleur; en een offline tablet kan zijn eigen offline-detectie niet triggeren. |
| **Plesk Scheduled Task → `node server/scripts/tick.js`, elke minuut** | **Gekozen**, naast lazy evaluatie. Draait buiten Passenger, is idempotent, en je ziet in de Plesk-taaklog of hij faalt. |

`tick.js` neemt `GET_LOCK('h20_tick', 0)` zodat overlappende runs onmogelijk zijn.

### Blokkerende voorwaarde

`migrate.js` draait nu `schema.sql` met `CREATE TABLE IF NOT EXISTS`. De
`ALTER TABLE`-statements hieronder zijn **niet** idempotent. Er moet eerst een
`schema_migrations`-tabel met genummerde stappen komen. Dit moet vóór fase 0.

---

## 1. Import uit de Google Spreadsheet

### Koppelmethode

| Methode | Oordeel |
|---|---|
| **Service-account + Sheets API v4, sheet gedeeld met het SA-adres** | **Gekozen.** Geen verlopende tokens, geen gebruikersinteractie, leest alleen wat expliciet gedeeld is. |
| Service-account met domain-wide delegation | Afgewezen — **niet nodig**. DWD geeft leesrecht op de hele Drive van het domein. De sheet simpelweg delen met het service-account-adres volstaat. |
| OAuth-gebruikersflow | Afgewezen. Token hangt aan één persoon en breekt bij vertrek. |
| Gepubliceerde CSV-URL | Afgewezen als primair: publiek raadbaar, Google cachet tot 5 min, datums komen als landinstellingsafhankelijke strings. Bruikbaar als noodfallback. |
| Apps Script dat naar ons pusht | Afgewezen als primair: het script leeft in het document, `onEdit` mist wijzigingen door andere scripts, en het shared secret staat in een door meerdere mensen bewerkbaar bestand. **Wel aanbevolen als latere aanvulling**: een menu-item "Nu synchroniseren". |

Pull is robuuster dan push: na elke storing convergeert het systeem vanzelf.

Implementatie zonder het zware `googleapis`-pakket: `google-auth-library` plus
een `fetch` met `valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`.
Datums komen dan als Google-serienummers in plaats van tekst — dat haalt de hele
klasse "is 11/10 nu 11 oktober of 10 november" weg.

Tijdzone: de sheet bevat lokale tijden zonder zone, de database is UTC. Eén
dependency erbij (`luxon`) voor correcte DST-conversie, alleen in de importlaag.

### Credentialopslag

`~/meetings.h20.gg/secrets/google-sa.json`, `chmod 600`, pad via
`GOOGLE_SA_KEY_FILE` in `server/.env`. Niet in git, niet in `public/`.

### Besluit: één bestand per ruimte

H20 houdt de planning bij als **één spreadsheet per vergaderruimte**
("Reserveringen Bundled", "Reserveringen Raboroom", enzovoort). Dat is
eenvoudiger dan één gedeeld bestand, om drie redenen:

1. **De ruimtekolom verdwijnt.** De ruimte ligt vast in de bronconfiguratie, dus
   er valt niets verkeerd te spellen. Daarmee vervalt in de praktijk de hele
   aliastabel en de categorie `unknown-room`-issues — veruit de grootste bron
   van importfouten. De aliastabel blijft wel bestaan voor een eventuele latere
   gedeelde bron.
2. **Een fout in één bestand raakt één ruimte.** Breekt iemand de koppen van
   "Reserveringen Lounge Café", dan loopt die ene import vast en gaan de andere
   drie gewoon door.
3. **Rechten per ruimte.** Je kunt het eventbestand delen met wie over die ruimte
   gaat, zonder dat diegene de rest ziet.

De prijs: vier bronnen in plaats van één om te configureren, en een event dat
twee ruimtes gebruikt staat in twee bestanden. Dat laatste was sowieso al zo,
want het systeem boekt per ruimte.

In `sheet_sources` komt hiervoor een kolom `fixed_room_id`. Is die gevuld, dan is
de kolom `Ruimte` in de sheet niet nodig en wordt hij genegeerd als hij er toch
staat.

De vier sjablonen staan in [`sheet-templates/`](sheet-templates/) — klaar om naar
Google Drive te slepen.

### Hoe de spreadsheet eruit moet zien

Het systeem past zich aan de sheet aan, niet andersom — kolommen worden op
**kopnaam** gemapt, niet op positie, dus je mag kolommen verplaatsen en er
tussenvoegen. Maar vier dingen moeten kloppen, anders kan geen enkele importer
er iets zinnigs van maken.

**De vier harde eisen**

1. **Eén kopregel, één tabel per tabblad.** Geen samengevoegde cellen, geen
   tussenkopjes als "— WEEK 12 —" tussen de rijen, geen tweede tabelletje
   rechts ernaast. Een tussenkopje is voor ons een rij zonder geldige datum.
2. **Eén rij is één boeking in één ruimte.** Een event dat drie ruimtes gebruikt,
   wordt drie rijen. Dat is geen administratieve pesterij: het systeem boekt per
   ruimte, dus "Aquarium + Bundled" in één cel kan niet correct verwerkt worden.
3. **Datum en tijd zijn échte datum- en tijdcellen**, geen tekst. Typ `09:00`,
   niet `9u` of `9.00 uur`. Je ziet het verschil doordat Google een echte tijd
   rechts uitlijnt en tekst links. Dit is de meest voorkomende oorzaak van een
   mislukte import.
4. **De ruimtenaam staat in een eigen kolom** en wordt consequent gespeld.
   Schrijfvarianten vangen we op met een aliastabel; wat we niet kunnen is
   "de grote zaal beneden" raden.

**Aanbevolen kolommen**

| Kolom | Verplicht | Toelichting |
|---|---|---|
| `Datum` | ja | Echte datumcel |
| `Van` | ja | Echte tijdcel, starttijd |
| `Tot` | ja* | Echte tijdcel, eindtijd. *Of in plaats hiervan een kolom `Duur` in minuten |
| `Ruimte` | ja | Edu Lab / Bundled / Lounge Café / Raboroom |
| `Event` | nee | Wordt de titel van de boeking |
| `Contact` | nee | E-mailadres van de verantwoordelijke. Leeg betekent het standaardadres van de bron |
| `ID` | aanbevolen | Zie hieronder |
| `Checkin` | nee | `ja` / `nee` — overrulet de standaard per rij |
| `Negeren` | nee | Zet er iets in en de rij wordt overgeslagen. Handig voor concepten en afgelaste events |

**De ID-kolom — kleine moeite, groot verschil**

Zonder ID moeten we een rij herkennen aan de combinatie ruimte + starttijd. Dat
werkt, maar het betekent dat **een gewijzigde starttijd of ruimte eruitziet als
"oude boeking weg, nieuwe boeking erbij"**. Functioneel klopt het resultaat, maar
je verliest het spoor tussen de twee.

Met een ID-kolom blijft het dezelfde boeking, ook als tijd en ruimte wijzigen. Het
hoeft niets slims te zijn — `EVT-001`, `EVT-002` volstaat, als een waarde maar
nooit hergebruikt wordt voor een ander event. Eén formule in de kolom die
automatisch nummert is genoeg.

**Wat mag en geen probleem is**

Extra kolommen die wij niet kennen (budget, aantal personen, opmerkingen),
voorwaardelijke opmaak, kleuren, filters, lege rijen tussen blokken, rijen in
het verleden, en de volgorde van de rijen. Dat wordt allemaal genegeerd.

**Waar het op stukloopt**

Een hernoemde kolomkop legt de import stil — dat is bewust: liever een duidelijke
foutmelding met Slack-bericht dan stilzwijgend de helft importeren. Een rij met
een eindtijd vóór de starttijd, een onbekende ruimtenaam of een onleesbare datum
wordt overgeslagen en komt als issue in Beheer te staan, met het rijnummer en de
ruwe celinhoud erbij. De rest van de import gaat gewoon door.

**Praktische volgorde**

Er komt een knop "Testen" in Beheer die de sheet leest en laat zien wat hij ervan
maakt — welke kolommen herkend zijn, welke rijen geplaatst zouden worden en welke
niet, **zonder iets weg te schrijven**. Daarmee kun je de sheet bijschaven voordat
er ooit een boeking ontstaat.

### Ruimtenamen uit vrije tekst

Een `room_aliases`-tabel: genormaliseerde alias (lowercase, zonder diakrieten)
naar `room_id`. Onbekende alias betekent **niet importeren**, maar een issue met
de ruwe celwaarde plus een knop "Koppel aan ruimte" in Beheer. Fuzzy matchen op
een ruimtenaam zet een event in de verkeerde zaal en dat merkt niemand tot het
misgaat.

### Idempotentie

Spreadsheet-rijen hebben geen stabiele identiteit. Tweetraps:

1. Heeft de bron een gevulde `event-id`-kolom, dan is dat de sleutel.
2. Anders een natuurlijke sleutel: `sha256(source_id | room_id | start_at_utc)`.

Daarnaast een `content_hash` over titel, eindtijd en e-mail. Onbekende sleutel
betekent aanmaken, bekende sleutel met gelijke hash betekent niets doen, bekende
sleutel met andere hash betekent bijwerken.

Gevolg dat we accepteren: starttijd of ruimte wijzigen laat de oude boeking
verdwijnen en maakt een nieuwe. Dat is functioneel correct.

### Verwijderde rijen

Mark-and-sweep per run. Links die deze run niet gezien zijn **en** in de toekomst
liggen worden verwijderd. Lopende of verstreken meetings nooit.

**Veiligheidsrem:** zou een run meer dan 30% of meer dan 10 toekomstige items
verwijderen, dan voert hij de sweep niet uit maar vraagt om bevestiging met een
Slack-melding. Dit vangt "iemand filterde de sheet of hernoemde een tab" af,
waar je anders in één keer de hele agenda kwijt bent.

### Conflicten met handmatige boekingen

De import plaatst nooit iets over iets anders heen en breekt nooit iets af.

| Situatie | Gedrag |
|---|---|
| Overlap met handmatig geplande meeting | Niet plaatsen. Issue `conflict-manual`. Admin kiest: event laten winnen, of sheet-rij negeren. |
| Overlap met lopende meeting | Nooit onderbreken. Issue `conflict-active`. |
| Overlap met ander geïmporteerd event | Issue `conflict-sheet` — fout in de sheet zelf. |

Niet automatisch laten winnen, omdat degene die handmatig boekte geen enkele
manier heeft om te zien dat zijn ruimte is afgepakt — er gaat nog geen mail uit.

### Frequentie

Cron elke 10 minuten, plus een knop "Nu synchroniseren" in Beheer.

---

## 2. Check-in met auto-release — marge 15 minuten

### Mechanisme

`promoteIfDue()` zet bij het activeren van een geplande meeting een
`checkin_deadline` op start + 15 minuten. `computeStatus()` krijgt er één tak
bij: deadline verstreken en niet ingecheckt betekent loggen in `meeting_history`
met `end_reason='no-show-release'` en de ruimte vrijgeven. `tick.js` doet
dezelfde controle zodat de historie ook klopt als niemand kijkt.

De marge staat als `checkin_grace_min` in `app_settings` met default 15 —
configureerbaar maken kost hier niets extra.

### Wie mag inchecken

Een boeker hoeft geen account te hebben (boeken vraagt alleen een e-mailadres),
dus "PIN van de boeker verplicht" faalt bij externe boekers. Bovendien is de
boeker vaak niet degene die als eerste binnenloopt.

| Modus | Oordeel |
|---|---|
| `tap` — één tik op "Wij zijn er" | **Default.** Het doel is detecteren dat *niemand* kwam, niet bewijzen *wie* kwam. Een voorbijganger die per ongeluk incheckt is een randgeval; een lege ruimte die drie uur rood blijft is het echte probleem. |
| `pin-any` — elke H20-gebruiker met PIN bevestigt | Zinvol als blijkt dat mensen gedachteloos inchecken. |
| `pin-owner` — alleen de boeker | Afgewezen als default: faalt bij externe boekers en bij de collega die er eerder is. |

Heeft de boeker wel een account, dan toont de tablet "Ik ben <naam>" als
snelkoppeling, zodat `checked_in_by` waar mogelijk een echte identiteit krijgt
voor de no-showrapportage.

### Ad-hoc meetings vereisen géén check-in

Wie ad-hoc start staat op dat moment voor de tablet — die handeling ís de
check-in. Een tweede bevestiging 15 minuten later zou een ruimte kunnen
vrijgeven waar mensen zitten te vergaderen. No-show is per definitie een
eigenschap van vooraf geboekte tijd.

### Per boeking aan en uit te zetten

Check-in is **geen systeembrede schakelaar maar een eigenschap van de boeking**.
Wie plant, bepaalt zelf of die boeking vervalt bij een no-show.

- `scheduled_meetings.requires_checkin` is de bron van waarheid per boeking.
- In het plan-venster op tablet en dashboard komt een schakelaar naast de al
  bestaande "titel tonen op het scherm":
  **"Vrijgeven als niemand incheckt"** — met daaronder in kleine letters
  "De ruimte komt 15 minuten na de starttijd weer vrij als er niet is ingecheckt."
- De beginstand van die schakelaar komt uit een default. Drie niveaus, van
  specifiek naar algemeen: de boeking zelf → de bron (bij een sheet-import) →
  de systeeminstelling `checkin_default` in `app_settings`.
- Achteraf wijzigen kan ook: een geplande meeting die nog niet begonnen is kan
  vanuit het dashboard omgezet worden. Daarna geldt de nieuwe stand meteen.
- Begint de meeting, dan wordt de vlag naar `active_meetings` overgenomen samen
  met de deadline. Is de check-in op dat moment al gedaan of niet meer vereist,
  dan verandert er niets meer aan die lopende sessie.

Suggestie voor de default: **aan** voor handmatig geplande meetings (dat is waar
no-show het probleem is) en **uit** voor geïmporteerde campus-events (zie
hieronder). Beide blijven per boeking te overrulen.

### Geïmporteerde campus-events: default géén check-in

`sheet_sources.requires_checkin` default 0, per bron instelbaar — en per rij te
overrulen met een kolom `checkin` in de sheet (zie 1.x). Bij een
toernooi of verhuur staat er zelden iemand om 10:00 bij de deur. De schade is
asymmetrisch: een gehuurde ruimte die om 10:16 vrijvalt en door iemand anders
wordt geboekt is reputatieschade naar een externe partij; een event dat 90
minuten onnodig rood blijft is interne frictie.

### Wat de tablet toont

1. **Wachtend op check-in**: scherm blijft rood, met een prominent blok:
   titel, "Check in binnen 12:34" aflopend, en één grote knop "Wij zijn er".
   Daaronder klein: "Niet ingecheckt? Dan komt de ruimte om 10:15 weer vrij."
2. **Laatste 3 minuten**: knop pulseert, teller groter. (Alleen op het scherm —
   de Hue-lamp blijft gewoon rood, zie feature 4.)
3. **Vrijgegeven**: scherm springt naar groen met een toast.

De aftelling synchroniseert bij elke poll met `serverTime` uit de API, anders
loopt een tablet met een scheve klok uit de pas. De beslissing valt altijd
server-side.

---

## 3. Tablet-heartbeat en offline-alert

### Interval

De vraag was elk uur of elk half uur. Beide zijn te traag.

| Interval | Detectietijd | Verkeer (4 tablets) | Oordeel |
|---|---|---|---|
| 60 min | tot 70+ min | niets | Te traag. Een dood scherm op maandagochtend ontdek je pas na de koffie. |
| 30 min | tot 40 min | niets | Nog steeds traag voor een scherm dat bezoekers zien. |
| **5 min** | **12 min** | 1152 requests/dag | **Gekozen.** |
| 1 min | 3 min | 5760/dag | Over-engineering; elke wifi-hik wordt een incident. |

1152 requests per dag is niets — de tablets pollen de status al elke paar
seconden. De 12-minutendrempel (twee gemiste beats plus marge) filtert een korte
AP-roam eruit en is snel genoeg om vóór de eerstvolgende vergadering in te grijpen.

Geen piggyback op de bestaande statuspoll: dat zou een GET state-veranderend
maken, wat botst met de bewuste keuze dat het leespad niets muteert.

### Alertvenster

Alerts worden alleen *verstuurd* tussen 07:00 en 20:00. Een tablet die om 03:40
wegvalt door een AP-reboot opent wel een episode in Beheer, maar het
Slack-bericht wacht tot 07:00 — en als het apparaat intussen terug is komt er
helemaal geen bericht. Dit is het verschil tussen monitoring die men blijft
lezen en monitoring die men dempt.

### Diagnostiek in de payload

App-versie (uit `sw.js` — zie meteen welke tablet een oude cache draait),
service-workerversie, `navigator.onLine`, schermafmeting en oriëntatie,
batterij (alleen Chromium, ontbreekt op iPad), of de wake-lock actief is, of de
tablet nog fullscreen staat, klok-afwijking ten opzichte van de server, laatste
succesvolle API-call, laatste fout, uptime sinds page-load.

Wake-lock en fullscreen zijn bewust meegenomen: een tablet waarvan het scherm
uitvalt of die uit de kioskmodus is, is functioneel net zo stuk als een offline
tablet.

### Anti-herhaling

Alerts zijn **episodes**, geen losse meldingen. Bestaat er al een open episode
van dit type voor dit apparaat, dan gebeurt er niets. Komt het apparaat terug,
dan wordt de episode gesloten — met een herstelbericht alleen als er destijds
ook een openingsbericht is gestuurd. Blijft een episode langer dan 24 uur open,
dan één herinnering. Daarna stil. Admin kan snoozen voor geplande werkzaamheden.

### Meldkanaal

Slack Incoming Webhook. E-mail bewust niet in de eerste versie: dat vraagt
nodemailer, afzenderconfiguratie, SPF/DKIM op `h20.gg` en bouncebeheer. De
notifier krijgt wel een kanaalabstractie zodat e-mail later één bestand is.

**Blinde vlek:** een systeem kan zijn eigen uitval niet melden. Een externe
uptime-check op `/healthz` is geen optie maar een voorwaarde zodra deze feature
de indruk wekt dat er gemonitord wordt.

---

## 4. Philips Hue

### Waarom de oude opzet uit PROJECT_PLAN 3.11 niet werkt

Die beschreef een `hue.js` in de browser die rechtstreeks met de bridge praat,
met de API-key in `localStorage`. Dat loopt op vijf punten vast:

1. **Mixed content.** `meetings.h20.gg` is HTTPS; een fetch naar
   `http://192.168.x.x` wordt hard geblokkeerd. Niet te omzeilen.
2. **Self-signed certificaat.** De bridge biedt HTTPS met een zelfondertekend
   certificaat. De browser weigert dat tot iemand per tablet handmatig een
   uitzondering accepteert — in fullscreen-kioskmodus praktisch onmogelijk, en
   zo'n uitzondering overleeft geen cache-wissing.
3. **CORS.** De bridge stuurt geen permissieve CORS-headers.
4. **De API-key staat op een publiek toegankelijk apparaat.** Die key is een
   permanente sleutel tot alle verlichting.
5. **Het werkt alleen vanaf het LAN.** Dashboard, Beheer en de cron kunnen de
   lampen dan niet aansturen — precies de momenten waarop een status verandert
   zonder dat er iemand bij een tablet staat.

### Afgewezen: de Plesk-server stuurt de bridge aan

Vereist dat de hoster bij het campus-LAN kan. Port-forward van de bridge naar
internet is onacceptabel (de Hue Bridge is niet gehard voor blootstelling: geen
noemenswaardige rate-limiting, één onveranderlijke bearer, een historie van
CVE's). Een VPN-tunnel kan niet op een gedeelde Plesk-omgeving.

### Gekozen: lokale agent op de campus

Een klein Node-proces op een bestaande Proxmox-VM. Geen nieuwe hardware.

1. Pollt elke 5 seconden `GET /api/light-state` met zijn device-token —
   uitsluitend uitgaande HTTPS, geen port-forward, geen open poort.
2. Zet alleen bij een wijziging een commando naar de bridge, dus ruim onder de
   throttling-grens.
3. Praat met de bridge via CLIP v2 op het eigen LAN; het self-signed certificaat
   is daar geen probleem.
4. Stuurt zijn eigen heartbeat mee in hetzelfde apparatenoverzicht als de
   tablets, dus je weet het als de agent uitvalt.

De application key verlaat de campus nooit en staat in `/etc/h20-hue/config.json`
met `chmod 600` — niet in `localStorage`, niet in de database, niet in git. De
server hoeft de key nooit te kennen; hij levert alleen kleuren uit. Dat is de
structurele winst: het geheim bestaat niet op de plek waar het kan lekken.

**Controleer eerst of er al Home Assistant draait op de campus.** Zo ja, dan is
dat verreweg de goedkoopste weg: een `rest`-sensor die het endpoint pollt plus
één automation per ruimte. Geen eigen code, geen eigen secretbeheer. Het
serverwerk (`/api/light-state`) is voor beide opties identiek, dus die keuze
hoeft het bouwen niet te blokkeren.

### Gedrag: strikt rood en groen

Conform de eerdere wens — geen pulse, geen tussenstaten.

| Status | Kleur |
|---|---|
| Beschikbaar | Groen |
| Beschikbaar, geplande meeting binnen 5 min | Groen (het scherm toont dat al) |
| Bezet | Rood |
| Bezet, wacht op check-in | Rood — de ruimte is formeel geboekt |
| Bezet, < 5 min resterend | Rood |
| Server of agent onbereikbaar | Geen actie, laatste kleur blijft staan |

De pulse-tabel in PROJECT_PLAN 3.11 moet hiermee vervangen worden, anders blijft
daar een verouderde specificatie staan.

---

## 5. Tablet-login per ruimte

### Apparaatsessie, geen gebruikerssessie

| | Gebruikerssessie | Apparaatsessie |
|---|---|---|
| Hangt aan | een persoon | een ding |
| Levensduur | 7 dagen, hoort te verlopen | lang, met een vaste maandelijkse herbevestiging — zie hieronder |
| Verlopen betekent | "log opnieuw in" — normaal | **een storing** — er is niemand om in te loggen |
| Rechten | alles wat de rol mag, campus-breed | precies één ruimte, precies de endpoints die de tablet nodig heeft |
| Intrekken | wachtwoord wijzigen | één apparaat, zonder iemand anders te raken |

Een gebruikersaccount op een tablet bij de deur betekent dat iemand met fysieke
toegang en vijf minuten tijd een sessie met dashboardrechten in handen heeft. En
elke boeking zou op naam van `tablet-aquarium@h20.gg` komen, wat de bestaande
audit-trail vervuilt.

### Token

32 random bytes, opgeslagen als SHA-256. Bewuste afwijking van de bcrypt-conventie
in dit project, en dat hoort als commentaar in de code: bcrypt bestaat om zwakke,
raadbare wachtwoorden duur te maken. Dit token heeft 256 bits entropie; bcrypt zou
alleen 100 ms CPU toevoegen aan een endpoint dat elke 5 seconden draait. Voor de
exit-PIN blijft bcrypt wél gelden — die is wel raadbaar.

Cookie `h20_device`, httpOnly, secure, SameSite Lax.

### Maandelijkse herbevestiging op de 1e

Gevraagd: de tablet maandelijks opnieuw laten inloggen, bijvoorbeeld op de 1e.
Dat kan, maar niet als harde vervaldatum om middernacht — dan staan er op
1 januari om 00:01 vier schermen die niemand meer kan bedienen, en moet er die
ochtend iemand langs vier deuren voordat het systeem weer werkt.

De werkbare vorm scheidt **vervallen** van **herbevestigen**:

| | Hoe |
|---|---|
| Token-geldigheid | 45 dagen, dus altijd ruim over de volgende 1e heen |
| Herbevestigingsmoment | De 1e van de maand, 's ochtends |
| Wat er dan gebeurt | De tablet toont bovenin een band: *"Maandelijkse controle — bevestig dit apparaat"*, met een knop. Eén tik door wie langsloopt, en het token schuift 45 dagen op. Admin kan het ook op afstand doen vanuit het apparatenoverzicht. |
| Niet bevestigd na 7 dagen | Slack-herinnering met de lijst apparaten die nog openstaan |
| Niet bevestigd na 45 dagen | Token vervalt. De tablet blijft de status tonen (laag 1 hieronder), maar boeken kan niet meer tot iemand opnieuw inschrijft |

Zo krijg je het maandelijkse ritme dat je wilt — er is elke maand een expliciet
moment waarop iemand bevestigt dat deze vier tablets nog van ons zijn en nog op
de juiste plek hangen — zonder dat een gemiste bevestiging meteen een storing is.
De 14 dagen tussen de 1e en het daadwerkelijk vervallen zijn de marge voor een
vakantie of een drukke week.

Praktisch: zet de controle in de maandelijkse ICT-routine, niet in iemands hoofd.
De Slack-melding op de 1e is de trigger.

Wil je het tóch strikt — token verloopt echt op de 1e — dan is dat één instelling,
maar dan moet er die ochtend gegarandeerd iemand met beheerrechten langs alle vier
de tablets. Dat is een operationele afspraak, geen technische.

Geen token in `localStorage` als backup: dat is leesbaar voor elk script op de
pagina en beschermt net zo min tegen fysieke toegang. De juiste oplossing is de
kioskbrowser goed instellen (cookies behouden, "clear cache on restart" uit) en
dat in de rolloutdocumentatie zetten.

### Scope

Middleware `requireDeviceOrUser`: geldig device-cookie waarvan de `room_id`
overeenkomt met de aangeroepen ruimte, óf een geldige gebruikerssessie, anders
401. Die tweede tak is essentieel — het dashboard roept dezelfde endpoints aan
voor verlengen en beëindigen.

Een tablet mag boeken, verlengen, beëindigen, plannen en inchecken **voor zijn
eigen ruimte**, plus de quickpick en PIN-verificatie. Niet: historie,
gebruikerslijst, instellingen, uitnodigingen, of welke call dan ook met een
andere ruimte-id. Een gestolen tablet uit de Lounge kan niets met de Raboroom.

### Enrollment

Admin maakt in Beheer een code aan (`K7M4-QPD2`, 15 minuten geldig, eenmalig) met
een QR-code erbij. Op de tablet: geen geldig cookie betekent geen loginformulier,
maar een compacte kaart met de ruimtenaam groot en één invoerveld. Of open de
QR-link en de code staat al ingevuld. Daarna laadt de tablet zichzelf opnieuw en
draait normaal.

### Als de sessie tóch verloopt terwijl er niemand staat

Dit is het belangrijkste ontwerppunt: **het scherm bij de deur mag nooit een
loginformulier worden.** Vijf lagen:

1. **De twee leesendpoints blijven open.** `GET /rooms/:id/status` en
   `/scheduled` vereisen geen token. Een tablet met een verlopen token toont dus
   nog steeds correct rood of groen met de juiste eindtijd. Dit is de
   belangrijkste veiligheidsklep.
2. **Degraderen, niet redirecten.** Een mutatie die 401 geeft dimt de
   boekknoppen en toont een discrete band "Boeken tijdelijk niet mogelijk". Geen
   redirect, geen witte pagina. Dit vereist dat de centrale
   `h20:unauthorized`-afhandeling in `app.js` op de tablet wordt uitgeschakeld —
   een kleine maar makkelijk te vergeten wijziging.
3. **Verlopen praktisch uitsluiten** via de maandelijkse herbevestiging met 14 dagen marge.
4. **Waarschuwen via Slack** op de 1e, en opnieuw na 7 dagen als er nog apparaten openstaan.
5. **Herstel zonder beheerder ter plaatse**: een admin maakt op afstand een code
   en stuurt de QR door; wie toevallig op de campus is houdt zijn telefoon voor
   de tablet.

### Verhouding tot de bestaande exit-PIN

Twee verschillende dingen die gescheiden moeten blijven: het device-token
beschermt de API, de exit-PIN beschermt het verlaten van de kioskmodus. Het token
geeft geen kiosk-exit en de PIN geeft geen API-rechten.

Drie problemen met de huidige exit-PIN die hierbij horen: hij staat als
**plaintext in `localStorage`** en wordt client-side vergeleken, de default is
`2026` op elke nog niet geconfigureerde tablet, en centraal wijzigen bestaat niet.

Voorstel: bcrypt-hash centraal in `app_settings`, gevalideerd via de API. Met één
nuance: **als de server onbereikbaar is moet de kiosk te verlaten blijven**,
anders kan niemand een tablet herstellen tijdens precies de storing waarvoor dat
nodig is. De tablet cachet daarom een bcrypt-hash lokaal als terugval. Dat is een
bewuste, gedocumenteerde concessie — en onvergelijkbaar veel beter dan de huidige
plaintext.

### Uitrol in drie standen

`DEVICE_AUTH_MODE`: `off` (alles werkt als nu), `warn` (mutaties zonder token
worden toegestaan maar geteld en gelogd), `enforce` (401). Zet `enforce` pas aan
als alle vier tablets op `ok` staan en de warn-teller 24 uur nul is. Dit voorkomt
dat je om 17:00 een beveiliging aanzet en om 09:00 vier dode schermen hebt.

---

## 6. Samenhang — vier harde raakvlakken

1. **Feature 5 bepaalt wie feature 2 en 3 mag aanroepen.** Check-in en heartbeat
   zijn precies de endpoints die een apparaatsidentiteit nodig hebben. Bouw je ze
   open en komt 5 later, dan moeten de tablets opnieuw langs. Bouw het
   device-model dus vroeg, maar zet enforcement laat aan.
2. **Feature 1 maakt de meetings die feature 2 gaat auto-releasen.** Zonder de
   `requires_checkin`-vlag per bron haalt de eerste import een campus-event om
   10:16 weg omdat er niemand op een tablet tikte.
3. **Feature 3 is voorwaarde voor een eerlijke feature 2.** Een boeking mag niet
   vervallen omdat de tablet offline was en niemand *kon* inchecken. De
   release-check moet de `last_seen_at` van het room-device raadplegen.
4. **Feature 4 leest de status die feature 2 verrijkt.** De staat "wacht op
   check-in" moet bestaan vóór de lichtkleur bepaald wordt.

---

## 7. Bouwvolgorde

| Fase | Inhoud | Waarom hier |
|---|---|---|
| **vooraf** | Versiemechanisme voor migraties (`schema_migrations`) | Blokkerend: de ALTER-statements zijn niet idempotent. |
| **0** | `app_settings` · `tick.js` + Plesk-cron · `notify.js` · `devices`-tabel in `off`-modus | Drie bouwstenen die vier features dragen. |
| **1** | **Check-in + auto-release** | Hoogste waarde per bouwuur, raakt geen bestaande auth, levert meteen de no-showdata die de rest verantwoordt. |
| **2** | **Heartbeat + apparatenoverzicht + offline-alert** | Klein werk, direct zichtbaar, en het overzicht is precies wat je in fase 3 nodig hebt om te zien of enrollment lukt. |
| **3** | **Tablet-login**, daarna `off` → `warn` → `enforce` | Pas als je kunt zien of de tablets gezond zijn. Enforcement is het enige onomkeerbare moment in dit plan. |
| **4** | **Sheet-import** | Het grootste en meest open stuk. Lever in twee stappen: eerst dry-run, dan pas schrijven. |
| **5** | **Hue** | Laagste urgentie en de enige die infrastructuur op de campus vraagt. Begin met de vraag of er al Home Assistant draait — dat bepaalt of dit een middag of een week is. |

Fase 0 tot en met 2 zijn samen de kleinste zinvolle oplevering: ongebruikte
ruimtes komen vanzelf vrij, en je weet het als een scherm uitvalt.

---

## 8. Openstaande besluiten

1. **Is de event-spreadsheet blijvend of een tussenstap?** Gaat H20 later naar
   echte Google Calendar room-resources, dan wordt de sheet-import overbodig of
   zelfs tegenstrijdig. De importlaag is bewust generiek ontworpen (`origin`,
   `source_id`, `sync_key`) zodat een Calendar-bron er later naast past.
2. **Privacy — besluit voor Matthijs.** Feature 1 zet eventtitels uit een
   gedeelde spreadsheet op een campus-breed zichtbaar dashboard, terwijl er
   huurders en externe partijen in het pand zitten. Advies: geïmporteerde events
   krijgen standaard geen zichtbare titel, met opt-in per bron.
3. **Check-in zonder PIN (`tap`)** — bewuste afweging tussen bruikbaarheid en
   bewijskracht. Bevestiging gewenst.
4. **De twee open leesendpoints na enforcement** zijn functioneel de juiste keuze,
   maar het is een expliciet geaccepteerde informatielek en moet als zodanig
   worden vastgelegd.
5. **Nieuwe geheimen**: Google service-account-key, Slack-webhook, Hue
   application key, device-tokens. Allemaal buiten git, allemaal met een
   rotatieprocedure in `DEPLOY.md`.
