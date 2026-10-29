---
paths:
  - "src/pages/TimeTracking.tsx"
  - "src/pages/MyHours.tsx"
  - "src/pages/HoursReport.tsx"
  - "src/pages/Reports.tsx"
  - "src/lib/timeBlockResolver.ts"
  - "src/lib/workingHours.ts"
  - "src/lib/offline*"
  - "src/components/VoiceInputButton.tsx"
  - "src/components/DashboardVoiceAssistant.tsx"
  - "src/components/TimeAccountManagement.tsx"
  - "src/components/LeaveManagement.tsx"
  - "supabase/functions/voice-to-form/**"
  - "supabase/functions/sprache-zu-text/**"
  - "supabase/functions/create-team-time-entries/**"
---
# Zeiterfassung, Pausenregel, Sprache

## Pausenregel
Die Mittagspause (12:00–12:30) muss bei der Zeiterfassung IMMER automatisch eingetragen werden und darf nie als
Arbeitszeit zählen — egal ob manuell eingegeben oder per Sprache diktiert. **Why:** Mitarbeiter vergessen die Pause; ohne
Automatik würden 9,0 h statt 8,5 h gebucht (Lohnabrechnung falsch).

Umgesetzt 2026-07-11: `timeBlockResolver.ts` (Zeitspannen-Diktat → Pause im Block; Dauer-Diktat → Split; Kernzeiten
07:00–16:00, Pause 12:00–12:30, Fr 07:00–12:00 ohne Pause) plus `withAutoPause` in TimeTracking.tsx (UI-Autofill +
Submit-Sicherheitsnetz). Bei Änderungen an der Zeiterfassung diese Invariante mittesten (10 Edge Cases). Regieberichte
sind bewusst ausgenommen (Pause nur wenn diktiert/eingegeben — Kundenverrechnung).

## Sprache / OpenAI
Seit 2026-08-31 liegt ein OpenAI-Schlüssel mit Guthaben als Supabase-Secret `OPENAI_API_KEY`. Der frühere war ohne
Guthaben (`insufficient_quota`). Modelle: **`gpt-4.1`** (Sprachassistent, `voice-to-form`) und **`gpt-4o-transcribe`**
(Abschrift in `voice-to-form` und `sprache-zu-text`). Dashboard-Sprachassistent auf der Startseite.

**Falle beim Testen von `voice-to-form` per curl:** Die Felder heißen `audioBase64` und **`audioMime`** (nicht
`mimeType`). Bei falschem Feldnamen fällt die Funktion auf `audio/webm` zurück und OpenAI antwortet irreführend mit
„Audio file might be corrupted or unsupported".

## Offline
Ganze App offline-fähig (Juli/Aug. 2026): Lesen aus lokaler Datenablage, Schreib-Warteschlange mit Auto-Sync
(`src/lib/offlineStore.ts`, `offlineQueue.ts`, `offlineData.ts`). Nachtrag offline: Kunde unterschreibt exakt den
gespeicherten Stand. Verrechnete Stunden sind sichtbar gesperrt (nur über `faktura_stunden_markieren`).
