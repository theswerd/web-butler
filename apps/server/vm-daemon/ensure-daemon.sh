#!/bin/sh
# Web Butler daemon supervisor, exec'd by the server whenever new work is
# queued for this VM. Args: <expected daemon version>. Self-updates the
# daemon source from the server when the version differs, then makes sure
# exactly one daemon is running. Prints MISSING when the install is absent
# so the server knows to (re)install first.
DIR=/opt/webbutler
WANT="$1"

[ -f "$DIR/daemon.json" ] || { echo MISSING; exit 0; }
[ -f "$DIR/daemon.mjs" ] || { echo MISSING; exit 0; }

HAVE=$(cat "$DIR/daemon.version" 2>/dev/null)
if [ -n "$WANT" ] && [ "$WANT" != "$HAVE" ]; then
  SERVER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DIR/daemon.json','utf8')).serverUrl)")
  if curl -fsS "$SERVER/api/daemon/source" -o "$DIR/daemon.mjs.new"; then
    mv "$DIR/daemon.mjs.new" "$DIR/daemon.mjs"
    echo "$WANT" > "$DIR/daemon.version"
    # A running daemon is on old code — retire it; we respawn below.
    PID=$(cat "$DIR/daemon.pid" 2>/dev/null)
    [ -n "$PID" ] && kill "$PID" 2>/dev/null
    rm -f "$DIR/daemon.pid"
    sleep 0.3
  fi
fi

PID=$(cat "$DIR/daemon.pid" 2>/dev/null)
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  echo RUNNING
  exit 0
fi

nohup node "$DIR/daemon.mjs" >> "$DIR/daemon.log" 2>&1 &
echo STARTED
