---
paths:
  - "supabase/functions/onedrive-sync/**"
  - "supabase/functions/onedrive-lesen/**"
  - "src/lib/projectFolders.ts"
  - "src/pages/ProjectFiles.tsx"
  - "src/components/ProjectFilesManager.tsx"
  - "src/components/QuickUploadDialog.tsx"
  - "src/components/FotoAufnahme.tsx"
  - "src/components/MobilePhotoCapture.tsx"
  - "src/components/DrawingEditor.tsx"
  - "docs/*onedrive*"
---
# OneDrive-Zwei-Wege-Sync und Projektordner

Der OneDrive-Zwei-Wege-Sync ist seit 2026-08-22 AKTIV und verifiziert. Erklärung für Christoph:
`docs/onedrive-sync-erklaerung.md`; Anleitung für die IT-Betreuung: `docs/anleitung-onedrive-microsoft365.md`.

**Konfiguration:**
- Ziel: OneDrive von Michael Ruff, `MS_DRIVE_TARGET=office@ruffinstallateur.at`
- Root: `ONEDRIVE_ROOT="1 Installateur Ruff/1 Kunde in Arbeit/1 Arbeit 2026"` (Michaels gewohnter Jahresordner)
- Secrets auf der Function `onedrive-sync`: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_DRIVE_TARGET, ONEDRIVE_ROOT
- Cron alle 10 Min (`cron.job` 'onedrive-sync'); zusätzlich Sofort-Einzelsync bei Projekt-Anlage (Parameter `projectId`)

**Mechanik:**
- `projects.onedrive_folder_id` = Graph-Item-ID; die Funktion folgt der ID egal wo der Ordner liegt → bestehende Ordner
  werden per SQL-Setzen der ID „verknüpft statt verschoben".
- Die Funktion kann technisch NICHTS in OneDrive löschen (kein DELETE im Code); Löschungen werden in keiner Richtung
  übertragen; Dateien >45 MB werden übersprungen.
- Ordnerstruktur an Michaels Praxis angeglichen (24.08.2026); Projektordner als eigene Kacheln, pro Projekt konfigurierbar.
- `onedrive-lesen` (nur lesend, Admin-only; Graph-`search` ist mit App-Rechten 403 → Ordner-für-Ordner-Crawl).

**Wartung:**
- **Jahreswechsel (Anfang 2027):** Michael legt „1 Arbeit 2027" an (oder per Graph), dann
  `supabase secrets set ONEDRIVE_ROOT="1 Installateur Ruff/1 Kunde in Arbeit/1 Arbeit 2027"`. Bestehende Projekte bleiben
  über ihre Ordner-IDs verbunden.
- **MS_CLIENT_SECRET läuft ca. 2028-08 ab** → IT-Betreuer erneuert Schritt 3 der Anleitung, dann Secret neu setzen.
  Rotation empfohlen (Schlüssel ging über Chat).

**Fotos/Dateien:** Foto-Knopf mit Serienaufnahme und Projektwahl, Skizze auf Foto (07.09.2026). 18.10.2026 (Michael:
„ich kann nicht foto hochladen“ – am Mac per Ziehen): Drag & Drop mit Hervorhebung, Fortschritt „3 von 5“, gleiche Datei
nochmal wählbar, Nicht-Bilder im Fotos-Ordner übersprungen.
