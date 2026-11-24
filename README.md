# Lokaler BPMN- und Formular-Editor

Ein lokaler Editor für BPMN-2.0-Dateien (`.bpmn`) und form-js-Formulare (`.form`). Gebaut aus [bpmn-js](https://github.com/bpmn-io/bpmn-js) und [form-js](https://github.com/bpmn-io/form-js). Du und ein Assistent könnt dieselben Dateien im selben Ordner bearbeiten: der Editor speichert auf die Festplatte, der Assistent liest und schreibt dieselben Dateien, und der Editor lädt Änderungen selbst nach (oder über „Neu laden").

Zum Starten wird **kein Node.js** benötigt. Eine kleine Go-Programmdatei bringt den Editor mit und stellt ihn unter `http://127.0.0.1:3456/` bereit.

Die fertigen Dateien liegen unter [Releases](https://github.com/ToasterKTN/bpmn-editor/releases).

## Start

Die passende Datei von der Release-Seite herunterladen:

| System | Datei |
| --- | --- |
| Linux x86_64 | `bpmn-editor-linux-amd64` |
| Linux arm64 | `bpmn-editor-linux-arm64` |
| Windows x86_64 | `bpmn-editor-windows-amd64.exe` |
| macOS Apple Silicon | `bpmn-editor-darwin-arm64` |

Unter Linux:

```bash
chmod +x bpmn-editor-linux-amd64
./bpmn-editor-linux-amd64 ./mein-ordner
```

Dann im Browser öffnen: <http://127.0.0.1:3456/>

Ohne Ordnerangabe landet die Ablage in `/workspace/bpmn-files`, falls dieser Ordner existiert, sonst in `./diagrams`. Der Server lauscht nur auf `127.0.0.1`, ist also nicht aus dem Netz erreichbar.

Anderer Port:

```bash
./bpmn-editor-linux-amd64 -port 3457 ./mein-ordner
```

Im Archiv des Repositories liegen zusätzlich `start.sh` und `start.cmd`, die die passende Datei unter `binaries/` starten, wenn du selbst gebaut hast.

## Zusammenarbeit mit dem Assistenten

1. Einen gemeinsamen Ordner festlegen, z. B. `./mein-ordner`.
2. Den Editor mit diesem Ordner starten.
3. Oben zwischen **BPMN** und **Formular** wechseln. Diagramme (`.bpmn`) und Formulare (`.form`) liegen im selben Ordner.
4. Speichern mit Strg+S. Der Assistent bearbeitet dieselben Dateien direkt auf der Festplatte.
5. Wenn eine geöffnete Datei sich ändert, aktualisiert der Editor sie automatisch – sofern du keine ungespeicherten Änderungen hast. Sonst erscheint ein Hinweis. „Neu laden" geht immer.

Im Formular-Editor rechts siehst du eine Vorschau des gerenderten Formulars.

## Ohne Server (nur Browser)

Die Datei `bpmn-editor.html` aus dem Release doppelt anklicken oder in den Browser ziehen. Öffnen und Speichern laufen dann über den Dateidialog bzw. den Download (kein gemeinsamer Ordner).

## Selbst bauen

Voraussetzungen: Node.js 18+ und Go 1.22+. Ordner namens `build`, `dist`, `out` oder `target` vermeiden (die werden auf manchen Arbeitsrechnern geleert).

```bash
npm ci
npm run bundle          # schreibt nach web/ und standalone/
bash tools/build-binaries.sh
./binaries/bpmn-editor-linux-amd64 ./diagrams
```

Ein Release entsteht automatisch, wenn ein Tag `v…` gepusht wird.

## Tastatur

| Kürzel | Aktion |
| --- | --- |
| Strg+N | Neues Diagramm bzw. Formular |
| Strg+O | Datei öffnen |
| Strg+S | Speichern |
| Strg+Umschalt+S | Speichern unter / Herunterladen |
| Strg+Z / Strg+Y | Rückgängig / Wiederholen |
| Entf | Element löschen |

## Lizenz

Der Rahmen in diesem Repository steht unter der MIT-Lizenz. bpmn-js und form-js bleiben unter der [bpmn.io-Lizenz](https://bpmn.io/license). Die bpmn.io-Wasserzeichen in der Zeichenfläche und im Formular dürfen nicht entfernt oder überdeckt werden. Details stehen in `LICENSE`.
