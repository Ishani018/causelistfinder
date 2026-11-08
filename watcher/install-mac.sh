#!/bin/sh
# Runs the watcher in the background on this Mac (it restarts at login), checking every 5 minutes
# in the daytime. Logs go to data/; the watcher's own output to data/watch.out.
# Undo with:  launchctl unload ~/Library/LaunchAgents/com.causelistfinder.watch.plist && rm ~/Library/LaunchAgents/com.causelistfinder.watch.plist
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.causelistfinder.watch.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$REPO/data"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.causelistfinder.watch</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$REPO/watcher/watch.js</string><string>--loop</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$REPO/data/watch.out</string>
  <key>StandardErrorPath</key><string>$REPO/data/watch.out</string>
</dict></plist>
PLIST
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Watcher running from $REPO. Check progress with: npm run report"
