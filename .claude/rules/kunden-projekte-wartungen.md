---
paths:
  - "src/pages/Customers.tsx"
  - "src/pages/Projects.tsx"
  - "src/pages/ProjectDetail.tsx"
  - "src/pages/ProjectOverview.tsx"
  - "src/pages/Wartungen.tsx"
  - "src/pages/Uebernahmen.tsx"
  - "src/components/kunde/**"
  - "src/components/projekt/**"
  - "src/components/wartung/**"
  - "src/components/restarbeiten/**"
  - "src/components/ProjectEditDialog.tsx"
  - "src/components/ErstaufnahmeDialog.tsx"
  - "src/components/UebernahmeDialog.tsx"
  - "src/lib/plz.ts"
  - "src/lib/projectLabel.ts"
  - "src/lib/wartung.ts"
  - "supabase/functions/generate-uebernahme-pdf/**"
---
# Kunden, Projekte, Wartungen, Restarbeiten

- **Eine Kundenauswahl (28.09.2026, Commit 45f847f):** `components/kunde/KundenAuswahl.tsx` ist DIE Kundenauswahl (Suche
  + „neu anlegen“ inline, geteilter Zwischenspeicher) — genutzt in NeuesProjektDialog, ProjectEditDialog, Erstaufnahme,
  Belege, Wartungen. `components/projekt/NeuesProjektDialog.tsx` ist der einzige „Neues Projekt“-Dialog (Projektliste,
  Dashboard, Zeiterfassung). Kunde wählen füllt Adresse automatisch vor. Neue Stellen mit Kundenwahl immer darüber bauen,
  keine eigenen Selects. Falle: beim Befüllen per setState-Updater nie `useRef().current` im Updater lesen.
- **Projektname „Nachname Straße Ort“** (`projektNameVorschlag` in lib/projectLabel.ts, `nameEnthaeltAdresse`
  verhindert doppelte Adresse).
- **PLZ:** Kunden- und Projekt-PLZ eigene Felder; `lib/plz.ts` (ohne Regex-Lookbehind — alte iPhones). Anlass 28.09.:
  „vierstellige PLZ wird abgelehnt“.
- **Wartungen** (`wartungen`, nur Admin): Seite `/wartungen`, Hinweis ganz oben am Dashboard sobald
  `faellig_am - vorlauf_tage` erreicht ist. Mail aus Vorlage (`app_settings.wartung_mail_vorlage`, Platzhalter {kunde}
  {wartung} {faellig} {projekt}, erste Zeile „Betreff:“), Versand über Outlook. Abschließen legt bei Intervall eine NEUE
  Zeile an (`vorgaenger_id`). „Rechnung erstellen“ = Entwurf über `belegEntwurfAnlegen` + Position „Wartung: …“.
- **Restarbeiten** (`restarbeiten`, alle Benutzer, löschen nur Admin): Knopf im Projekt, Schild in der Projektliste.
  Farben als `style`, weil das KingBill-Knopfdesign Tailwind-Hintergründe überschreibt.
- Kunden: 113 echte Kunden aus OneDrive (23.08.2026), danach 1.650 aus KingBill; mehrere heißen „Fassl“ — im Test nach
  „1100 Wien“ wählen.
