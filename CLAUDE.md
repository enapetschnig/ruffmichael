# Ruff Michael – Kundenakte

Kurze Akte für jede KI (VS Code, Änderungswunsch-Roboter, Codex). Detailwissen steht nach Thema unter
`.claude/rules/` (Index unten). Es gibt keine `JOURNAL.md`; Verlauf = `git log` (ausführliche Commit-Texte, gezielt
per `git log --grep` suchen). Testbericht: `~/Developer/_baukasten/testberichte/ruffmichael-2026-09-21.md`.

## Kunde
- **Ruff Michael GmbH**, 2601 Eggendorf (Niederösterreich) – Installateur (Wärme/Kälte/Regelung, Heizungstausch,
  Wartungen). Website `ruffinstallateur.at`. Im CRM Kundennummer **918**, App-Schlüssel `ruffmichael`.
- **Michael Ruff** – Inhaber, Konto `office@ruffinstallateur.at` (seit 07.09.2026 Administrator), meldet Wünsche
  selbst über die App, kurz und direkt („Hallo …“). Sein Rechtsanwalt bestimmt Formulierungen (Arbeitsbestätigung).
- Stand Sept. 2026: **beide Konten (Michael, Christoph) sind Administratoren, es gibt keinen echten Mitarbeiter** –
  im Test kein Mitarbeiter-Konto anlegen.
- Abgelöste Altsoftware: **KingBill** (Angebote/Rechnungen 2017–2026, am 21.09.2026 komplett übernommen). Michaels
  Dateien liegen in **OneDrive** (Microsoft 365), Mail und Kalender in **Outlook**.
- App ist ein Lovable-Export (seit 11.07.2026 eigenes Supabase); `README.md` ist noch der Lovable-Standardtext.
  Design und Menüführung an die Groismaier-App angeglichen (07.09.2026), KingBill-Optik bei Belegen.

## Rollen
`app_role`: `administrator`, `mitarbeiter`. Nur Admins: Angebote & Rechnungen (`/belege`), E-Mail (`/postfach`),
Eingangsrechnungen, Kalender, Wartungen, Materialpreise. Mitarbeiter: Zeiterfassung, Projekte/Fotos, Arbeitsbestätigung
(Regiebericht), Nachträge, Restarbeiten.

## Fachbegriffe
- **Arbeitsbestätigung** = „Auftrag und Arbeitsbestätigung für Regieleistung“ (seit 04.10.2026, auf Wunsch Michaels/
  Rechtsanwalt). Im Code weiter **Regiebericht** / `disturbances` / Route `/disturbances`, OneDrive-Ordner „Regieberichte“.
- **Belege** = Angebot, Auftragsbestätigung, Rechnung, Gutschrift („Faktura“). „… erstellen“ vergibt die Nummer
  (RPC `beleg_festschreiben`). **Anbote** = Michaels Ordnername für Beleg-PDFs.
- **Nachtrag**, **Übernahme(bestätigung)**, **Erstaufnahme**, **Restarbeiten**, **Wartung** (wiederkehrend).
- **Stundensätze**: Monteur 82 / Service Monteur 97 / Partie 164 € (aus Michaels altem Angebot, 07.09.2026).
- Projektname-Schema: **„Nachname Straße Ort“** (28.09.2026).

## Feste Regeln und No-Gos
- **Mitarbeiter sehen nie Preise** (Materialpreise in `material_prices`, RLS nur Admin). Angebote/Rechnungen strikt nur Admin.
- **OneDrive: nichts verändern, nichts löschen** („aber nichts bei onedrive verändern“, „ich möchte nicht das bei
  onedrive irgendwas gelöscht wird“). Die Sync-Funktion kann technisch nichts löschen.
- **In Outlook wird nichts verändert** (Christoph, 10.09.2026) – nur lesen und neue Mails senden.
- **Mittagspause 12:00–12:30 immer automatisch, zählt nie als Arbeitszeit** (außer in Arbeitsbestätigungen, dort nur
  wenn diktiert/eingegeben – Kundenverrechnung).
- Festgeschriebene Belege sind unveränderbar und nicht löschbar; Korrektur nur per Storno/Gutschrift.
- Materialkatalog enthält **nur Materialien, keine Arbeitszeit** („nur Materialien, keine Arbeitszeit“, 07.09.2026).
- Alles „idioteneinfach“ und überall gleich (eine Kundenauswahl, ein „Neues Projekt“-Dialog für die ganze App).
- Tests: keine Nachrichten an echte Personen, Testdaten `ZZTEST`, **Löschen nur per expliziter ID** (ein
  `like 'ZZTEST%'` hat am 07.09.2026 einen echten Entwurf erwischt). Christophs 4 Entwürfe „Max Mustermann“ nie löschen.
  Neue Projekte im Test per `page.route` abfangen (der OneDrive-Cron legt sonst echte Ordner an).
- Zugangsdaten nie ausgeben oder in Dateien schreiben.

## Technik
- React + Vite + TypeScript + shadcn/Tailwind, offline-fähig (lokale Datenablage + Schreib-Warteschlange,
  `src/lib/offline*.ts`), PWA mit Selbst-Aktualisierung. Farben Orange `#F07002`, Schwarz `#1A1A18`.
- **Supabase** `xaugcspfgtuozlijdfqu` (eu-west-1). Functions u. a. `beleg-pdf`, `send-disturbance-report`, `outlook`,
  `onedrive-sync`, `onedrive-lesen`, `voice-to-form`, `sprache-zu-text`, `wunsch-datei`, `generate-uebernahme-pdf`.
  Deploy: `npx supabase functions deploy <name> --project-ref xaugcspfgtuozlijdfqu --no-verify-jwt` (CLI war zeitweise
  nicht angemeldet → dann MCP `deploy_edge_function` mit komplettem Dateiinhalt).
- **Hosting:** Vercel-Projekt `c-hris-projects/ruffmichael`, echte Adresse **`https://ruff.handwerkapp.at`** (gleich
  `ruffmichael.vercel.app`). Push auf `main` von `github.com/enapetschnig/ruffmichael` = Deploy.
- **Gates vor Commit:** `npm run typecheck` (= `tsc --noEmit -p tsconfig.app.json`; ein nacktes `npx tsc --noEmit`
  prüft NICHTS), `npm run build`.
- **Migrationen:** Datei in `supabase/migrations/`, live über Management-API `POST /v1/projects/{ref}/database/query`
  (mit `User-Agent: curl/8.4`, sonst 403/1010), danach in `supabase_migrations.schema_migrations` eintragen.
- PostgREST liefert höchstens 1.000 Zeilen → Kunden/Belege immer über `alleZeilen()` (`src/lib/alleZeilen.ts`) laden.
- Cron-Jobs (pg_cron): `onedrive-sync` alle 10 Min, `outlook-mail-sync` alle 5 Min.

## Wissen nach Thema
| Thema | Datei | Wann lesen |
|---|---|---|
| Angebote & Rechnungen (Faktura) | `.claude/rules/faktura-belege.md` | Belege, Nummernkreise, PDF/Vorschau, Export, Storno, Artikelkatalog |
| KingBill-Import | `.claude/rules/kingbill-import.md` | Altbestand, Import-Skripte, Access-Zahlenfallen |
| E-Mail, Eingangsrechnungen, Kalender | `.claude/rules/outlook-postfach.md` | Postfach, Mailversand, Eingangsrechnungs-Erkennung |
| OneDrive-Sync & Projektordner | `.claude/rules/onedrive-projektordner.md` | Ordner, Sync, Fotos/Dateien hochladen |
| Arbeitsbestätigung (Regiebericht) | `.claude/rules/arbeitsbestaetigung.md` | Bericht, PDF, Versand über Outlook, Entwurf |
| Zeiterfassung & Sprache | `.claude/rules/zeiterfassung.md` | Pausenregel, Zeitblöcke, Diktat, OpenAI |
| Material & Preise | `.claude/rules/material-preise.md` | Materialkatalog, Preise nur Admin, Nachträge |
| Kunden, Projekte, Wartungen | `.claude/rules/kunden-projekte-wartungen.md` | Kundenauswahl, Neues Projekt, PLZ, Wartungen, Restarbeiten |
| Änderungswünsche | `.claude/rules/aenderungswuensche.md` | Melde-Knopf, Cockpit-Weiterleitung |
| Testen | `.claude/rules/testen.md` | Klicktests, Testfallen, Zähler zurücksetzen |

## Wissen ablegen (für jede KI – auch den Roboter)
- Diese Datei ist die kurze Kundenakte und bleibt unter 25 KB. Hier nur: wer der Kunde ist, feste Regeln, Technik, Index.
- Neue Erkenntnis, Fallstrick oder Entscheidung zu einem Thema → in die passende Datei unter `.claude/rules/`
  (mit Datum und, wenn von Christoph/Kunde, dem Zitat). Gibt es kein passendes Thema: neue Datei mit `paths:` auf die
  betroffenen Code-Ordner anlegen und oben im Index eintragen.
- Ausführliche Protokolle, Testberichte, Abläufe → `JOURNAL.md` oder `research_notes/`, nicht hierher.
