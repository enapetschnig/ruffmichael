---
paths:
  - "supabase/migrations/**"
  - "tsconfig*.json"
  - "package.json"
---
# Testen, Typcheck, Testfallen

## Typcheck-Falle
`tsconfig.json` hat `files: []` und nur Referenzen; ein `npx tsc --noEmit` ohne `-p` meldet immer Exit 0 und prüft keine
einzige Datei. `vite build` typisiert ebenfalls nicht. Dadurch blieb 2026-09-02 ein echter Absturz über mehrere Commits
unbemerkt. Vor jedem Commit `npm run typecheck` (= `tsc --noEmit -p tsconfig.app.json`).

## Zugang beim Testen
Supabase-CLI/Token waren zeitweise ungültig (401). Service-Key steht in `cron.job` (Bearer im Befehl) → per SQL lesen,
Login per `auth/v1/admin/generate_link` + `verify`. Management-API blockt Python-urllib → `User-Agent: curl/8.4`.

## Rahmen und Fallen (Volltest 21.09.2026, ~230 Prüfungen)
- Beide Konten sind Administratoren — kein Mitarbeiter-Konto; keins anlegen.
- Alle Projekte hängen an OneDrive (dort wird nie gelöscht) → Fotos/Skizze/Upload nur mit `page.route(...)`-Abfangen der
  Storage-POSTs testen; Belege ohne Projekt anlegen (PDF unter `_ohne_projekt/Anbote/`, per Storage-API löschen).
- Zähler nach Beleg-Tests zurücksetzen (`faktura_nummernkreise`; Trigger `trg_loeschschutz`/`trg_schreibschutz`/
  `trg_pos_schreibschutz` kurz aus). Generierte Spalte `belege.kreis` ist in BEFORE-Triggern in NEW NULL. Trigger, die
  `has_role(auth.uid())` prüfen, müssen `auth.uid() IS NULL` (Service-Kontext) durchlassen.
- `first()` auf „Bearbeiten"/„Bezahlt" in Listen erwischt ECHTE Zeilen → vorher per Suche auf die ZZTEST-Zeile
  einschränken (hat einmal eine echte Eingangsrechnung verändert).
- Zeiterfassung/Admin/Mitarbeiter/Regieberichte haben kein `<main>` → `body` lesen. Speichern dauert manchmal >2,5 s →
  auf die DB-Zeile warten. Nach „X erstellen" blockt die PDF-Vorschau Klicks → warten + Escape.
- `time_entries` verlangt `start_time`/`end_time`, `location_type` nur baustelle|werkstatt. PostgREST-Bulk-Insert braucht
  identische Schlüssel je Objekt.
- Playwright im Session-Scratchpad installieren (`npm i playwright && npx playwright install chromium`), Preview-Server in
  eigenem Bash-Aufruf starten; Port 4173 oft belegt → 4199.
