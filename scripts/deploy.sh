#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 user@host [ssh_port]"; exit 1
fi

TARGET="$1"
SSH_PORT="${2:-22}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO_ROOT/bin/multiboard-sync-service"
STATIC_DIR="$REPO_ROOT/cmd/server/static"
SERVICE_UNIT_LOCAL="$REPO_ROOT/deployment/systemd/multiboard-sync-service.service"

if [[ ! -x "$BIN" ]]; then
  echo "Binary not found. Run scripts/build.sh first."; exit 1
fi

ssh -p "$SSH_PORT" "$TARGET" "sudo mkdir -p /opt/multiboard-sync-service/bin /opt/multiboard-sync-service/cmd/server/static /var/lib/multiboard-sync-service/dumps /var/lib/multiboard-sync-service/backups /var/log/multiboard-sync-service && \
  if ! id multiboard >/dev/null 2>&1; then sudo useradd --system --no-create-home --shell /usr/sbin/nologin multiboard; fi && \
  sudo chown -R multiboard:multiboard /opt/multiboard-sync-service /var/lib/multiboard-sync-service /var/log/multiboard-sync-service && \
  sudo chmod 750 /opt/multiboard-sync-service && sudo chmod -R 750 /var/lib/multiboard-sync-service /var/log/multiboard-sync-service"

scp -P "$SSH_PORT" "$BIN" "$TARGET:/tmp/multiboard-sync-service"
ssh -p "$SSH_PORT" "$TARGET" "sudo mv /tmp/multiboard-sync-service /opt/multiboard-sync-service/bin/multiboard-sync-service && sudo chown multiboard:multiboard /opt/multiboard-sync-service/bin/multiboard-sync-service && sudo chmod 750 /opt/multiboard-sync-service/bin/multiboard-sync-service"

if [[ -d "$STATIC_DIR" ]]; then
  rsync -a -e "ssh -p $SSH_PORT" "$STATIC_DIR/" "$TARGET:/tmp/static/"
  ssh -p "$SSH_PORT" "$TARGET" "sudo rsync -a /tmp/static/ /opt/multiboard-sync-service/cmd/server/static/ && sudo chown -R multiboard:multiboard /opt/multiboard-sync-service/cmd/server/static && sudo rm -rf /tmp/static"
fi

scp -P "$SSH_PORT" "$SERVICE_UNIT_LOCAL" "$TARGET:/tmp/multiboard-sync-service.service"
ssh -p "$SSH_PORT" "$TARGET" "sudo mv /tmp/multiboard-sync-service.service /etc/systemd/system/multiboard-sync-service.service && sudo systemctl daemon-reload && sudo systemctl enable multiboard-sync-service"

echo "Place your .env at /opt/multiboard-sync-service/.env with: sudo chown multiboard:multiboard and chmod 640"
echo "Then: sudo systemctl restart multiboard-sync-service && sudo systemctl status multiboard-sync-service --no-pager"
