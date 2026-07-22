#!/usr/bin/env bash
# Serves the SecureBank FinBot chat UI at http://localhost:3000.
# The page calls the backend on localhost:10000 (start that with ./run_local.sh).
cd "$(dirname "$0")/ui" || { echo "ui/ folder not found"; exit 1; }
echo "FinBot UI  →  http://localhost:3000    (Ctrl-C to stop)"
exec python3 -m http.server 3000 --bind 127.0.0.1
