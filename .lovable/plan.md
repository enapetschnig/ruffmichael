# Offene Projekte auf einen Blick in der Zeiterfassung

## Ziel

In der Zeiterfassung soll eine **einfache Liste aller offenen Projekte** sichtbar sein — als Referenz, damit der Nutzer weiss, auf welches Projekt er seine Stunden buchen kann. Kein Detailreport, keine Auswertung — nur die Projektnamen zum Nachschauen.

Zusaetzlich: Der bereits geplante dauer-basierte Sprachbefehl („zwei Stunden auf Projekt Mueller") wird umgesetzt.

## 1. Projektliste (ausklappbar)

- Neue **Collapsible-Karte** in `src/pages/TimeTracking.tsx`, oberhalb der Zeitbloecke.
- Titel: „Offene Projekte" mit Anzahl-Badge und Chevron.
- Liest alle Projekte mit `status = 'aktiv'` (oder allen ausser `abgeschlossen`) aus `projects`.
- Zeigt pro Projekt eine schmale Zeile: **Projektname** • PLZ (klein/muted).
- Sortierung alphabetisch.
- Kompakt: max. 3-4 Zeilen sichtbar mit Scroll, wenn viele Projekte.
- Standard: **eingeklappt** (nur ausklappen wenn gebraucht), Zustand in `localStorage` gemerkt.
- Rein informativ — kein Klick-Verhalten, keine Aenderung an der bestehenden Projekt-Auswahl im Zeitblock.

## 2. Dauer-basierte Spracheingabe mit automatischer Pause

Erweiterung der bestehenden Sprach-Funktion:

- Nutzer kann sagen: „Zwei Stunden auf Projekt Mueller, dann drei Stunden Baustelle Napetschnig."
- Die App legt die Bloecke sequenziell **ab 07:00** an (Regelarbeitszeit).
- Faellt ein Block ueber 12:00–12:30, wird automatisch eine Pause 12:00–12:30 vorgeschlagen und das Ende um 30 Minuten verschoben, damit die Arbeitszeit korrekt bleibt.
- Nutzer sieht das Ergebnis wie bisher im Formular und kann alles vor dem Speichern korrigieren.

### Aenderungen

- `supabase/functions/voice-to-form/index.ts`: Schema um `durationHours` (Zahl) je Block erweitern; Prompt lernt Dauer-Modus.
- `src/lib/timeBlockResolver.ts` (NEU): reine Utility, die aus Dauer/Zeit-Angaben + Anker 07:00 + Pausenfenster 12:00–12:30 konkrete `startTime`/`endTime`/`pauseStart`/`pauseEnd` berechnet. Enthaelt Logik fuer automatische Pausen-Einfuegung.
- `src/pages/TimeTracking.tsx`:
  - Neue Projekt-Referenzliste (Punkt 1).
  - `handleVoiceResult` schickt die AI-Bloecke durch den Resolver.
  - Kleines Badge/Toast informiert, wenn eine Pause vorgeschlagen wurde.

## Keine Aenderungen an

- Datenbank, RLS, Speicher-Logik.
- Regiebericht-Formular.
- Bestehende Projekt-Auswahl im Zeitblock (Dropdown bleibt wie es ist).
