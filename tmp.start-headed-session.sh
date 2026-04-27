#!/usr/bin/env bash
set -euo pipefail
export DISPLAY=:1
export XAUTHORITY=/root/.Xauthority
mkdir -p /opt/vault-headed/profile
pkill -f 'Xvfb :1' || true
pkill -f 'openbox' || true
pkill -f '/opt/vault-headed/profile' || true
rm -f /tmp/.X1-lock || true
Xvfb :1 -screen 0 1280x800x24 -ac +extension RANDR > /var/log/vault-xvfb.log 2>&1 &
sleep 2
openbox > /var/log/vault-openbox.log 2>&1 &
sleep 2
exec /usr/bin/google-chrome \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-background-networking \
  --disable-component-update \
  --disable-features=MediaRouter,OptimizationHints,Translate,AutofillServerCommunication,CertificateTransparencyComponentUpdater \
  --disable-renderer-backgrounding \
  --disable-background-timer-throttling \
  --disable-breakpad \
  --disable-sync \
  --metrics-recording-only \
  --mute-audio \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check \
  --user-data-dir=/opt/vault-headed/profile \
  --window-size=1280,800 \
  --new-window \
  https://theabcvault.com/ > /var/log/vault-chrome.log 2>&1
