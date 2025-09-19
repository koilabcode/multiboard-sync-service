#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$REPO_ROOT/bin"
mkdir -p "$BIN_DIR"

pushd "$REPO_ROOT" >/dev/null
go mod tidy
GOOS=linux GOARCH=amd64 go build -o "$BIN_DIR/multiboard-sync-service" ./cmd/server
popd >/dev/null

echo "Built: $BIN_DIR/multiboard-sync-service"
