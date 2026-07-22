#!/usr/bin/env bash
# Simple FinBot chat in your terminal. Usage:
#   ./chat.sh                         → talk as Mike Wilson (permitted → allowed)
#   ./chat.sh employee@securebank     → talk as a blocked user (denied at the door)
USER_ID="${1:-mike.wilson@revapreview.onmicrosoft.com}"
NAME="${2:-Mike Wilson}"
echo "======================================================"
echo " FinBot — acting as: $USER_ID"
echo " Type a question and press Enter.  Ctrl-C to quit."
echo "======================================================"
while true; do
  printf "\nyou> "
  read -r q || break
  [ -z "$q" ] && continue
  q="$q" USER_ID="$USER_ID" NAME="$NAME" python3 -c '
import os, json, urllib.request
body = json.dumps({"message": os.environ["q"], "user_id": os.environ["USER_ID"],
                   "user_name": os.environ["NAME"], "role": "manager"}).encode()
req = urllib.request.Request("http://localhost:10000/chat", data=body,
                            headers={"Content-Type": "application/json"})
try:
    r = json.load(urllib.request.urlopen(req, timeout=150))
    print("\nfinbot>", r.get("response", ""))
except Exception as e:
    print("\n[error]", e, "— is the backend running? (./run_local.sh)")
'
done
