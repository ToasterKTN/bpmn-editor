#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f web/index.html ]; then
  echo "web/ fehlt. Zuerst: npm run bundle" >&2
  exit 1
fi
mkdir -p binaries
export CGO_ENABLED=0
build() {
  GOOS=$1 GOARCH=$2 go build -trimpath -ldflags='-s -w' -o "binaries/$3" .
  echo "built binaries/$3"
}
build linux amd64 bpmn-editor-linux-amd64
build linux arm64 bpmn-editor-linux-arm64
build windows amd64 bpmn-editor-windows-amd64.exe
build darwin arm64 bpmn-editor-darwin-arm64
cd binaries
sha256sum bpmn-editor-linux-amd64 bpmn-editor-linux-arm64 bpmn-editor-windows-amd64.exe bpmn-editor-darwin-arm64 > SHA256SUMS
cat SHA256SUMS
