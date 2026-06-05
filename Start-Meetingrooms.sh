#!/usr/bin/env bash
# H20 Meetingrooms — lokale start
# Dubbelklik dit bestand om het project te starten.

set -e

PROJECT_DIR="/home/tom/Desktop/Meetingroom Project"
PORT=8080
DASHBOARD="http://localhost:${PORT}/dashboard.html"
ADMIN="http://localhost:${PORT}/admin.html"

cd "$PROJECT_DIR"

# Stop eventuele eerdere server op dezelfde poort
if lsof -ti:${PORT} >/dev/null 2>&1; then
  echo "Poort ${PORT} is in gebruik — stoppen..."
  kill $(lsof -ti:${PORT}) 2>/dev/null || true
  sleep 1
fi

echo "============================================"
echo "  H20 Meetingrooms"
echo "  Map:     $PROJECT_DIR"
echo "  Beheer:  $ADMIN"
echo "  Overzicht: $DASHBOARD"
echo ""
echo "  Ruimtes (tablet-modus):"
echo "    http://localhost:${PORT}/tablet.html?room=aquarium"
echo "    http://localhost:${PORT}/tablet.html?room=bundled"
echo "    http://localhost:${PORT}/tablet.html?room=lounge"
echo "    http://localhost:${PORT}/tablet.html?room=raboroom"
echo "============================================"
echo ""
echo "Server start op poort ${PORT}..."
echo "Sluit dit venster om de server te stoppen."
echo ""

# Open dashboard na 1 seconde
( sleep 1 && xdg-open "$DASHBOARD" >/dev/null 2>&1 ) &

# Start statische webserver (Python staat standaard op Ubuntu)
python3 -m http.server ${PORT}
