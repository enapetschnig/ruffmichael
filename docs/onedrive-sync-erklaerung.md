# Wie die OneDrive-Verbindung funktioniert

*Einfach erklärt — für Michael, Christoph und alle, die wissen wollen, was da im Hintergrund passiert.*

---

## Die Grundidee in einem Satz

**Die App und Michaels OneDrive sind zwei Fenster in denselben Raum:** Was auf der
einen Seite hineingelegt wird, erscheint automatisch auch auf der anderen.

---

## Wo liegen die Sachen?

In OneDrive landet alles genau dort, wo Michael es gewohnt ist:

```
OneDrive (office@ruffinstallateur.at)
└── 1 Installateur Ruff
    └── 1 Kunde in Arbeit
        └── 1 Arbeit 2026          ← hier arbeitet die App
            ├── Grossenberger Ackergasse 58 …   ← ein Projekt
            ├── Fassl Viktor Heizungstausch
            └── Müller Hauptstraße 12           ← neu aus der App
                ├── Fotos             ← Kachel „Fotos" in der App
                ├── Plan              ← Kachel „Pläne"
                ├── Regieberichte     ← Kachel „Regieberichte"
                ├── Material          ← Kachel „Material"
                ├── Abnahme Protokoll ┐
                ├── Anbote            │ Michaels Standardordner,
                ├── Anleitungen       │ erscheinen in der App als
                ├── Doko              │ eigene Ordner-Kacheln
                ├── Mail              │
                └── Programmierung    ┘
```

Ein Projekt in der App = ein Ordner in OneDrive. Immer.

---

## Wann passiert was?

**1. Neues Projekt in der App anlegen → Ordner kommt sofort**
Egal ob über „Projekte", die Zeiterfassung oder die Erstaufnahme: Sekunden später
steht der Ordner mit allen Unterordnern in OneDrive.
*Ohne Internet:* Das Projekt wird lokal gespeichert und der Ordner entsteht
automatisch, sobald wieder Empfang da ist.

**2. Alle 10 Minuten: der große Abgleich**
Ein automatischer Lauf schaut auf beiden Seiten nach, was neu oder geändert ist,
und gleicht es an:
- Foto in der App aufgenommen → liegt danach in OneDrive
- PDF am PC in den Projektordner gelegt → erscheint in der App
- Neuer Unterordner in OneDrive → wird in der App zur Ordner-Kachel

**3. Dazwischen passiert nichts von selbst** — es gibt keinen Live-Zugriff. Was
gerade in OneDrive liegt, sieht die App erst nach dem nächsten Abgleich.

---

## Was passiert, wenn beide etwas ändern?

Die App merkt sich bei jedem Abgleich, welchen Stand beide Seiten hatten. Damit
erkennt sie beim nächsten Mal genau, **wer wirklich etwas geändert hat**:

| Situation | Ergebnis |
|---|---|
| Nur in der App geändert | Wird nach OneDrive kopiert |
| Nur in OneDrive geändert | Wird in die App kopiert |
| **Auf beiden Seiten** geändert | Die **neuere** Datei gewinnt |
| Nichts geändert | Nichts passiert (kein sinnloses Hin- und Herkopieren) |

---

## 🔒 Wichtig: In OneDrive wird nie etwas gelöscht

Das ist keine Einstellung, sondern in der Technik verankert: Die Sync-Funktion
**kann** in OneDrive nur lesen, Ordner anlegen und Dateien hochladen. Einen
Löschbefehl gibt es dort schlicht nicht.

- Datei in der App gelöscht → bleibt in OneDrive erhalten
- Datei in OneDrive gelöscht → bleibt in der App erhalten
- Nichts wird verschoben oder umbenannt

Löschen muss man also bewusst auf beiden Seiten — dafür kann nie versehentlich
etwas verschwinden.

---

## Der Chefordner bleibt privat

Der Ordner **„Chef"** wird **bewusst nicht** synchronisiert. Er existiert nur in
der App, ist ausschließlich für Administratoren sichtbar und taucht in OneDrive
gar nicht erst auf.

---

## Bestehende Projekte übernehmen

Alte Projekte müssen **nicht** verschoben werden. Sie werden einfach *verknüpft*:
Die App merkt sich die Kennung des vorhandenen OneDrive-Ordners — der bleibt, wo
er ist, und wird ab dann mitsynchronisiert. So sind z. B. „Grossenberger" und
„FRAUENTAL PERCHTOSDORF" in die App gekommen.

Wer weitere Alt-Projekte in die App holen will, sagt einfach Bescheid: welcher
Ordner, fertig.

---

## Was die Verbindung (noch) nicht kann

- **Neuer Ordner direkt in OneDrive** wird nicht automatisch zu einem Projekt in
  der App. Neue Projekte bitte **in der App** anlegen — dann stimmt beides.
- **Dateien über 45 MB** werden nicht in die App übernommen (Speichergrenze der
  App). In OneDrive bleiben sie natürlich normal liegen.
- **Umbenennen** eines Projekts in der App ändert den OneDrive-Ordnernamen nicht.
  Die Verknüpfung bleibt trotzdem bestehen (sie hängt an der Ordner-Kennung,
  nicht am Namen).
- **Löschungen** werden nicht übertragen (siehe oben — Absicht).

---

## Technischer Anhang (für Christoph)

**Zugang:** Microsoft Entra App-Registrierung „RuffMichael App Sync",
App-Only über Microsoft Graph mit Berechtigung `Files.ReadWrite.All`.
Zugangsdaten liegen als Supabase-Function-Secrets: `MS_TENANT_ID`,
`MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_DRIVE_TARGET`, `ONEDRIVE_ROOT`.

**Funktion:** `supabase/functions/onedrive-sync/index.ts`
- `?action=test` → Verbindungstest (zeigt Ziel-OneDrive und Root-Ordner)
- `?action=sync` → kompletter Abgleich (so ruft der Cron alle 10 Min auf)
- `?action=sync&projectId=…` → nur ein Projekt (nutzt die App direkt nach der Anlage)

**Zustandshaltung:** Tabelle `onedrive_sync_state` (je Datei: Stand beider Seiten
beim letzten Abgleich) und `projects.onedrive_folder_id` (Graph-Item-ID des
Projektordners — überlebt Umbenennungen auf beiden Seiten).

**Grenzen pro Lauf:** max. 200 Übertragungen bzw. 110 Sekunden; der Rest läuft
beim nächsten Durchgang weiter (Antwort enthält dann `partial: true`).

**Wartung:**
- **Jahreswechsel:** `ONEDRIVE_ROOT` auf den neuen Jahresordner setzen
  (z. B. „1 Installateur Ruff/1 Kunde in Arbeit/1 Arbeit 2027"). Bestehende
  Projekte bleiben über ihre Ordner-Kennung verbunden.
- **Client-Secret läuft ca. August 2028 ab** → IT-Betreuer wiederholt Schritt 3
  der Einrichtungsanleitung (`docs/anleitung-onedrive-microsoft365.md`),
  danach Secret neu setzen.
