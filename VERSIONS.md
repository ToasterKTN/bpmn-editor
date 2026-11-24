# Versionen

Lokaler BPMN- und Formular-Editor, gebaut am 24. November 2026.

## bpmn-js (aus dem Quellcode gebaut)

- Repository: https://github.com/bpmn-io/bpmn-js
- Version: 18.33.1
- Commit: 3327bcf5c823dd45c43c0936eceaf046181b6869
- Commit-Datum: 23. November 2026, 13:48 (Europe/Zurich)
- Build: `npm install` im geklonten Repo (führt `npm run distro` aus)
- Lizenz: bpmn.io / Camunda Services GmbH (siehe LICENSE)
  Das bpmn.io-Wasserzeichen in der Zeichenfläche muss sichtbar bleiben.

## form-js (aus dem Quellcode gebaut)

- Repository: https://github.com/bpmn-io/form-js
- Version: 2.2.0 (schemaVersion 19)
- Commit: 9ae9b49193ba73c6d660c3935439cb70c47c8da4
- Commit-Datum: 23. November 2026, 13:48 (Europe/Zurich)
- Build: `npm install` und `npm run build` im geklonten Monorepo
- Pakete: @bpmn-io/form-js-editor 2.2.0, @bpmn-io/form-js-viewer 2.2.0
- Lizenz: bpmn.io / Camunda Services GmbH (siehe LICENSE)
  Das bpmn.io-Wasserzeichen im Formular muss sichtbar bleiben.

## Weitere Bibliotheken (offizielle npm-Pakete)

- bpmn-js-properties-panel 5.65.4 (MIT)
- @bpmn-io/properties-panel 3.60.2 (MIT)

## Laufzeit

Der Editor für Endnutzer ist ein statisch gelinktes Go-Programm (Go 1.22+, nur Standardbibliothek, `CGO_ENABLED=0`). Node.js wird nur zum Bündeln der Oberfläche benötigt, nicht zum Starten.
