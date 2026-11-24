#!/bin/sh
set -e
cd "$(dirname "$0")"
DIR="${1:-./diagrams}"
OS=$(uname -s)
ARCH=$(uname -m)
case "$OS-$ARCH" in
  Linux-x86_64)  BIN=./binaries/bpmn-editor-linux-amd64 ;;
  Linux-amd64)   BIN=./binaries/bpmn-editor-linux-amd64 ;;
  Linux-aarch64) BIN=./binaries/bpmn-editor-linux-arm64 ;;
  Linux-arm64)   BIN=./binaries/bpmn-editor-linux-arm64 ;;
  Darwin-arm64)  BIN=./binaries/bpmn-editor-darwin-arm64 ;;
  *)
    echo "Keine passende Programmdatei für $OS $ARCH."
    echo "Bitte die passende Datei in binaries/ direkt starten."
    exit 1
    ;;
esac
if [ ! -x "$BIN" ]; then
  echo "Datei nicht gefunden oder nicht ausführbar: $BIN"
  exit 1
fi
echo "Öffne http://127.0.0.1:${PORT:-3456}/ im Browser."
exec "$BIN" ${PORT:+-port "$PORT"} "$DIR"
