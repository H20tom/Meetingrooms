#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy Meetingrooms H20 naar productie
#
# Zelfde opzet en bediening als deploy.sh van de receptie-app: reservekopie
# vooraf, controle achteraf, en automatisch terugzetten als er iets misgaat.
#
# Gebruik:
#   bash deploy.sh --controle    kijk alleen wat er zou gebeuren, wijzig niets
#   bash deploy.sh --deploy      voer de deploy echt uit
#
# Er wordt niets verstuurd zonder dat de controles slagen.
#
# Verschil met de receptie-app, bewust:
#   - Meetingrooms draait onder Phusion Passenger, niet onder PM2. Herstarten
#     is `touch tmp/restart.txt`; er is geen procesmanager om te bevragen.
#   - Versturen gaat met rsync in plaats van scp-per-bestand. Er gaan hier meer
#     bestanden mee (server/ heeft meerdere mappen) en rsync stuurt alleen de
#     verschillen, controleert op inhoud en kan vooraf precies laten zien wat
#     het zou doen.
#   - Er is geen aanwezigheidscontrole nodig: een herstart van Meetingrooms
#     raakt geen lopende vergaderingen, die staan in de database.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# ── Instellingen ────────────────────────────────────────────────────────────
SSH_DOEL="${DEPLOY_SSH:-h20.gg@92.205.228.124}"
SERVER_MAP="${DEPLOY_MAP:-/var/www/vhosts/h20.gg/meetings.h20.gg}"
# Plesk-node. .node-version zegt 24; valt terug op 22 als 24 er niet staat.
NODE_PAD="${DEPLOY_NODE_PAD:-/opt/plesk/node/24/bin}"
NODE_PAD_RESERVE="/opt/plesk/node/22/bin"
# /healthz is publiek en doet een echte database-ping. Ligt MySQL plat, dan
# geeft hij 503 en rolt dit script netjes terug.
GEZONDHEID_URL="${DEPLOY_HEALTH:-https://meetings.h20.gg/healthz}"

# Veiligheidsrem: gaan er onverwacht veel bestanden mee, dan klopt er iets niet.
MAX_BESTANDEN="${DEPLOY_MAX:-40}"

PROJECT_MAP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOKALE_MAP="$PROJECT_MAP"
STEMPEL="$(date +%Y%m%d-%H%M%S)"
LOGBESTAND="$PROJECT_MAP/deploy-logboek/${STEMPEL}.log"

# Wat er naar de server gaat. Alles wat hier niet in staat blijft lokaal:
# documentatie, de sjablonen, .claude, het startscript en bovenal server/.env,
# node_modules en dev-local.js.
RSYNC_FILTER=(
  --include='/app.js'
  --include='/.node-version'
  --include='/public/'
  --include='/public/**'
  --include='/server/'
  --include='/server/*.js'
  --include='/server/*.json'
  --include='/server/*.sql'
  --include='/server/lib/'
  --include='/server/lib/**'
  --include='/server/routes/'
  --include='/server/routes/**'
  --include='/server/scripts/'
  --include='/server/scripts/**'
  --exclude='/server/dev-local.js'
  --exclude='/server/.env'
  --exclude='*'
)

MODUS="${1:-}"
if [[ "$MODUS" != "--controle" && "$MODUS" != "--deploy" ]]; then
  echo "Gebruik: bash deploy.sh --controle | --deploy"
  exit 1
fi

mkdir -p "$(dirname "$LOGBESTAND")"

# ── Hulpfuncties ────────────────────────────────────────────────────────────
ROOD=$'\033[31m'; GROEN=$'\033[32m'; GEEL=$'\033[33m'; VET=$'\033[1m'; UIT=$'\033[0m'

zeg()   { echo "$*" | tee -a "$LOGBESTAND"; }
kop()   { zeg ""; zeg "${VET}$*${UIT}"; }
goed()  { zeg "  ${GROEN}ok${UIT}    $*"; }
fout()  { zeg "  ${ROOD}FOUT${UIT}  $*"; }
letop() { zeg "  ${GEEL}let op${UIT} $*"; }

# Eén SSH-verbinding hergebruiken: scheelt meerdere keren inloggen.
SSH_SOK="/tmp/deploy-meetings-${STEMPEL}.sock"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$SSH_SOK" -o ControlPersist=300 -o ConnectTimeout=15)
opruimen() { ssh "${SSH_OPTS[@]}" -O exit "$SSH_DOEL" 2>/dev/null || true; }
trap opruimen EXIT

opserver() { ssh "${SSH_OPTS[@]}" "$SSH_DOEL" "$1"; }
opserver_node() { ssh "${SSH_OPTS[@]}" "$SSH_DOEL" "export PATH=$NODE_PAD:\$PATH; cd $SERVER_MAP && $1"; }

gezondheid() {
  # Geeft "200 ok" terug als de app leeft én de database bereikbaar is.
  local body code
  body="$(curl -s --max-time 20 -w '\n%{http_code}' "$GEZONDHEID_URL" 2>/dev/null)"
  code="$(echo "$body" | tail -1)"
  if [[ "$code" == "200" ]] && echo "$body" | head -n -1 | grep -q '"db"[[:space:]]*:[[:space:]]*"up"'; then
    echo "200 ok"
  else
    echo "$code"
  fi
}

zeg "${VET}Deploy Meetingrooms H20${UIT}"
zeg "modus     : $MODUS"
zeg "doel      : $SSH_DOEL:$SERVER_MAP"
zeg "logboek   : $LOGBESTAND"

# ── 1. Lokale controles ─────────────────────────────────────────────────────
kop "1. Lokale controles"

cd "$LOKALE_MAP" || { fout "lokale map niet gevonden"; exit 1; }

if ! command -v rsync >/dev/null 2>&1; then
  fout "rsync staat niet op deze computer — gestopt"
  zeg "        Installeren met: sudo apt install rsync"
  exit 1
fi
goed "rsync aanwezig ($(rsync --version | head -1 | awk '{print $3}'))"

FOUTEN=0
while IFS= read -r f; do
  node --check "$f" 2>/dev/null || { fout "schrijffout in $f"; FOUTEN=$((FOUTEN+1)); }
done < <(git ls-files 'app.js' 'server/**/*.js' 'server/*.js' 'public/*.js' | grep -v 'dev-local.js')
if [[ $FOUTEN -eq 0 ]]; then goed "alle JS-bestanden zijn syntactisch in orde"
else fout "$FOUTEN bestand(en) met een schrijffout — gestopt"; exit 1; fi

# De pagina's hebben inline <script>-blokken; die worden door node --check niet
# gezien. Hier apart uit de HTML trekken en controleren.
HTML_FOUT=0
for h in $(git ls-files 'public/*.html'); do
  python3 - "$h" <<'PY' >/tmp/inline-$$.js 2>/dev/null || continue
import io,re,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
print('\n'.join(re.findall(r'<script>(.*?)</script>', s, re.S)))
PY
  if [[ -s /tmp/inline-$$.js ]]; then
    node --check /tmp/inline-$$.js 2>/dev/null || { fout "schrijffout in inline script van $h"; HTML_FOUT=$((HTML_FOUT+1)); }
  fi
  rm -f /tmp/inline-$$.js
done
if [[ $HTML_FOUT -eq 0 ]]; then goed "inline scripts in de pagina's zijn in orde"
else fout "$HTML_FOUT pagina(s) met een schrijffout — gestopt"; exit 1; fi

if git diff --quiet && git diff --cached --quiet; then
  goed "geen niet-opgeslagen wijzigingen"
else
  letop "er zijn wijzigingen die nog niet in git staan"
  git status --short | sed 's/^/         /' | tee -a "$LOGBESTAND"
fi

HUIDIGE_COMMIT="$(git log -1 --format='%h %s')"
zeg "         te deployen versie: $HUIDIGE_COMMIT"

# ── 2. Server bereikbaar ────────────────────────────────────────────────────
kop "2. Server bereikbaar"

if opserver "echo verbonden" >/dev/null 2>&1; then goed "SSH-verbinding werkt"
else fout "geen SSH-verbinding met $SSH_DOEL — gestopt"; exit 1; fi

if opserver "test -d $SERVER_MAP"; then goed "app-map bestaat"
else fout "map $SERVER_MAP bestaat niet — gestopt"; exit 1; fi

if opserver "command -v rsync >/dev/null 2>&1"; then
  goed "rsync aanwezig op de server"
else
  fout "rsync staat niet op de server — gestopt"
  zeg "        Zonder rsync kan dit script niets versturen. Vraag Joey of de"
  zeg "        hoster om 'rsync' te installeren, of draai de deploy met de hand:"
  zeg "        ssh $SSH_DOEL 'cd $SERVER_MAP && git pull origin main'"
  exit 1
fi

if opserver "test -d $NODE_PAD"; then
  goed "node gevonden in $NODE_PAD"
else
  if opserver "test -d $NODE_PAD_RESERVE"; then
    letop "$NODE_PAD bestaat niet, teruggevallen op $NODE_PAD_RESERVE"
    NODE_PAD="$NODE_PAD_RESERVE"
  else
    fout "geen Plesk-node gevonden in $NODE_PAD of $NODE_PAD_RESERVE — gestopt"
    exit 1
  fi
fi

# ── 3. Staat de configuratie op de server ───────────────────────────────────
kop "3. Configuratie op de server"

# Zonder .env heeft de app geen databasegegevens en start hij niet op. Dat
# bestand wordt bewust nooit meegestuurd, dus het moet er al staan.
if opserver "test -s $SERVER_MAP/server/.env"; then
  goed "server/.env staat op de server"
else
  fout "server/.env ontbreekt of is leeg — gestopt"
  zeg "        Zonder dat bestand kan de app geen verbinding met de database maken."
  exit 1
fi

# Achter HTTPS hoort COOKIE_SECURE op true te staan, anders is de sessiecookie
# niet aan HTTPS gebonden en stuurt de app geen HSTS-header.
if opserver "grep -qi '^COOKIE_SECURE=true' $SERVER_MAP/server/.env"; then
  goed "COOKIE_SECURE staat op true"
else
  letop "COOKIE_SECURE staat niet op true in server/.env"
  zeg "        De sessiecookie is dan niet aan HTTPS gebonden en er gaat geen"
  zeg "        HSTS-header uit. Zet COOKIE_SECURE=true en herstart."
fi

VOOR_GEZOND="$(gezondheid)"
if [[ "$VOOR_GEZOND" == "200 ok" ]]; then goed "app draait nu (healthz: db up)"
else letop "app antwoordt nu met: $VOOR_GEZOND"; fi

# ── 4. Wat gaat er mee ──────────────────────────────────────────────────────
kop "4. Wat gaat er mee"

RSYNC_BASIS=(-az --checksum --itemize-changes --no-perms --no-owner --no-group
             -e "ssh ${SSH_OPTS[*]}")

DROOG="$(rsync "${RSYNC_BASIS[@]}" --dry-run "${RSYNC_FILTER[@]}" \
          "$LOKALE_MAP/" "$SSH_DOEL:$SERVER_MAP/" 2>&1)"
RS_CODE=$?
if [[ $RS_CODE -ne 0 ]]; then
  fout "rsync-proefrun mislukte (code $RS_CODE)"
  echo "$DROOG" | sed 's/^/         /' | tee -a "$LOGBESTAND"
  exit 1
fi

# Alleen regels die een echte bestandswijziging zijn (>f...), geen mappen.
mapfile -t TE_STUREN < <(echo "$DROOG" | grep -E '^[<>]f' | awk '{print $2}')
NIEUW_AANTAL="$(echo "$DROOG" | grep -cE '^[<>]f\+\+\+\+\+\+' || true)"

if [[ ${#TE_STUREN[@]} -eq 0 ]]; then
  kop "Niets te doen"
  zeg "Alle bestanden op de server zijn al gelijk aan die van jou."
  exit 0
fi

zeg "         ${#TE_STUREN[@]} bestand(en) wijken af, waarvan ${NIEUW_AANTAL} nieuw:"
for f in "${TE_STUREN[@]}"; do zeg "           - $f"; done

if [[ ${#TE_STUREN[@]} -gt $MAX_BESTANDEN ]]; then
  fout "dat zijn er meer dan verwacht ($MAX_BESTANDEN). Controleer eerst wat er"
  fout "aan de hand is. Gestopt."
  exit 1
fi

# Wat moet er na het versturen gebeuren?
NPM_NODIG=false
MIGRATIE_NODIG=false
for f in "${TE_STUREN[@]}"; do
  [[ "$f" == server/package.json || "$f" == server/package-lock.json ]] && NPM_NODIG=true
  [[ "$f" == server/schema.sql ]] && MIGRATIE_NODIG=true
done
zeg ""
zeg "         npm install nodig : $NPM_NODIG"
zeg "         migratie nodig    : $MIGRATIE_NODIG"
zeg "         herstart          : altijd (Passenger)"

if [[ "$MODUS" == "--controle" ]]; then
  kop "Controle klaar"
  zeg "Er is niets gewijzigd. Draai 'bash deploy.sh --deploy' om het echt te doen."
  exit 0
fi

# ── 5. Reservekopie op de server ────────────────────────────────────────────
kop "5. Reservekopie maken"

BACKUP_MAP="$SERVER_MAP/backups/deploy-$STEMPEL"
BACKUP_TAR="$BACKUP_MAP/vorige-versie.tar.gz"
opserver "mkdir -p $BACKUP_MAP" || { fout "kon geen reservekopie-map maken — gestopt"; exit 1; }

# Alles wat we kunnen overschrijven in één archief. server/.env gaat bewust
# mee in de kopie — niet om te versturen, maar om hem terug te kunnen zetten
# als er onverhoopt iets mee gebeurt.
if opserver "cd $SERVER_MAP && tar czf $BACKUP_TAR --exclude=backups --exclude=node_modules --exclude=tmp app.js .node-version public server 2>/dev/null"; then
  GROOTTE="$(opserver "du -h $BACKUP_TAR | cut -f1" | tr -d '[:space:]')"
  goed "reservekopie gemaakt ($GROOTTE)"
  zeg "         $BACKUP_TAR"
else
  fout "reservekopie maken mislukte — gestopt"
  exit 1
fi

# ── 6. Bestanden versturen ──────────────────────────────────────────────────
kop "6. Bestanden versturen"

UITVOER="$(rsync "${RSYNC_BASIS[@]}" "${RSYNC_FILTER[@]}" \
            "$LOKALE_MAP/" "$SSH_DOEL:$SERVER_MAP/" 2>&1)"
if [[ $? -ne 0 ]]; then
  fout "versturen mislukte"
  echo "$UITVOER" | sed 's/^/         /' | tee -a "$LOGBESTAND"
  exit 1
fi
goed "${#TE_STUREN[@]} bestand(en) verstuurd"

# Controleren dat het ook echt gelijk is: een tweede proefrun hoort nu leeg
# te zijn op bestandsniveau.
REST="$(rsync "${RSYNC_BASIS[@]}" --dry-run "${RSYNC_FILTER[@]}" \
         "$LOKALE_MAP/" "$SSH_DOEL:$SERVER_MAP/" 2>/dev/null | grep -cE '^[<>]f' || true)"
if [[ "$REST" == "0" ]]; then goed "server is nu gelijk aan jouw versie"
else letop "$REST bestand(en) wijken nog steeds af"; fi

opserver "chmod -R u+rw,go+r,go-w $SERVER_MAP/public $SERVER_MAP/server $SERVER_MAP/app.js 2>/dev/null" \
  && goed "rechten gezet"

# ── 7. Terugzetten bij problemen ────────────────────────────────────────────
terugzetten() {
  kop "TERUGZETTEN"
  zeg "Er ging iets mis. De vorige versie wordt teruggeplaatst."
  if opserver "cd $SERVER_MAP && tar xzf $BACKUP_TAR"; then
    goed "vorige versie teruggezet"
  else
    fout "terugzetten mislukte — het archief staat nog in $BACKUP_TAR"
  fi
  opserver "mkdir -p $SERVER_MAP/tmp && touch $SERVER_MAP/tmp/restart.txt" >/dev/null 2>&1
  sleep 8
  CODE="$(gezondheid)"
  if [[ "$CODE" == "200 ok" ]]; then
    zeg ""; zeg "${GROEN}De site draait weer op de oude versie.${UIT}"
  else
    zeg ""; zeg "${ROOD}LET OP: de site antwoordt met $CODE. Bel Johan.${UIT}"
  fi
  zeg ""
  zeg "Reservekopie staat nog in: $BACKUP_TAR"
  zeg "Logboek van deze deploy: $LOGBESTAND"
  exit 1
}

# ── 8. Afhankelijkheden en migratie ─────────────────────────────────────────
if [[ "$NPM_NODIG" == true ]]; then
  kop "7. npm install"
  if opserver_node "cd server && npm install --omit=dev --no-audit --no-fund" >/dev/null 2>&1; then
    goed "afhankelijkheden bijgewerkt"
  else
    fout "npm install mislukte"; terugzetten
  fi
else
  kop "7. npm install niet nodig"
  goed "package.json is niet gewijzigd"
fi

if [[ "$MIGRATIE_NODIG" == true ]]; then
  kop "8. Database-migratie"
  # migrate.js is idempotent: CREATE TABLE IF NOT EXISTS en ON DUPLICATE KEY
  # UPDATE. Een bestaand admin-account wordt niet overschreven.
  MIG="$(opserver_node "cd server && node scripts/migrate.js" 2>&1)"
  if [[ $? -eq 0 ]]; then
    goed "migratie uitgevoerd"
    echo "$MIG" | sed 's/^/         /' | tee -a "$LOGBESTAND"
  else
    fout "migratie mislukte"
    echo "$MIG" | sed 's/^/         /' | tee -a "$LOGBESTAND"
    terugzetten
  fi
else
  kop "8. Migratie niet nodig"
  goed "schema.sql is niet gewijzigd"
fi

# ── 9. Herstarten ───────────────────────────────────────────────────────────
kop "9. App herstarten"

# Passenger start de app opnieuw zodra dit bestand nieuwer is dan het proces.
if opserver "mkdir -p $SERVER_MAP/tmp && touch $SERVER_MAP/tmp/restart.txt"; then
  goed "herstart aangevraagd (tmp/restart.txt)"
else
  fout "kon tmp/restart.txt niet aanraken"; terugzetten
fi
zeg "         even wachten tot de app op gang is..."
sleep 6

# ── 10. Controle ────────────────────────────────────────────────────────────
kop "10. Controle"

GELUKT=false
for poging in 1 2 3 4 5 6; do
  CODE="$(gezondheid)"
  if [[ "$CODE" == "200 ok" ]]; then GELUKT=true; break; fi
  zeg "         poging $poging: $CODE, nog even wachten..."
  sleep 5
done

if [[ "$GELUKT" == true ]]; then goed "app antwoordt en de database is bereikbaar"
else fout "app antwoordt niet goed na 6 pogingen"; terugzetten; fi

# Steekproef op de echte schermen: deze moeten alle drie een pagina opleveren.
for pad in "/login.html" "/dashboard.html" "/tablet.html?room=aquarium"; do
  C="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://meetings.h20.gg${pad}")"
  if [[ "$C" == "200" ]]; then goed "https://meetings.h20.gg${pad} (200)"
  else letop "https://meetings.h20.gg${pad} gaf $C"; fi
done

# Lekt de gebruikerslijst? Sinds 06-11-2026 hoort quickpick geen e-mailadressen
# meer terug te geven. Dit is de controle die dat bewaakt.
QP="$(curl -s --max-time 15 https://meetings.h20.gg/api/users/quickpick)"
if echo "$QP" | grep -q '"email"'; then
  letop "LET OP: /api/users/quickpick geeft nog e-mailadressen terug"
else
  goed "quickpick lekt geen e-mailadressen"
fi

# ── Klaar ───────────────────────────────────────────────────────────────────
kop "Klaar"
zeg "Versie live: $HUIDIGE_COMMIT"
zeg "Reservekopie: $BACKUP_TAR"
zeg ""
zeg "Terugzetten kan met:"
zeg "  ssh $SSH_DOEL 'cd $SERVER_MAP && tar xzf $BACKUP_TAR'"
zeg "  ssh $SSH_DOEL 'touch $SERVER_MAP/tmp/restart.txt'"
zeg ""
zeg "Logboek van deze deploy: $LOGBESTAND"
