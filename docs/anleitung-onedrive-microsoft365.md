# Anleitung: App-Zugang für die OneDrive-Synchronisation einrichten

**Für:** IT-Betreuung von Ruff Michael GmbH (Microsoft 365 Firmenkonto)
**Dauer:** ca. 10 Minuten
**Wichtig:** Du brauchst dafür ein Microsoft-365-**Administrator**-Konto der Firma.

**Worum geht's:** Die Mitarbeiter-App von Ruff Michael soll die Projektordner
automatisch mit OneDrive abgleichen (in beide Richtungen). Damit das darf,
braucht sie einen eigenen technischen Zugang im Microsoft-365-Konto der Firma.
Den legst du mit den Schritten unten an. Am Ende schickst du uns 4 Angaben zurück.

---

## Schritt 1: App-Registrierung anlegen

1. Öffne im Browser: **https://entra.microsoft.com**
2. Melde dich mit dem **Administrator-Konto** der Firma an.
3. Klicke links im Menü auf **„App-Registrierungen"**
   (falls du es nicht siehst: links oben auf „Alle anzeigen" / das Menü-Symbol klicken,
   dann unter **Anwendungen → App-Registrierungen**).
4. Klicke oben auf **„+ Neue Registrierung"**.
5. Fülle aus:
   - **Name:** `RuffMichael App Sync`
   - **Unterstützte Kontotypen:** die erste Option lassen
     („Nur Konten in diesem Organisationsverzeichnis")
   - **Umleitungs-URI:** leer lassen
6. Klicke unten auf **„Registrieren"**.

Du landest jetzt auf der Übersichtsseite der neuen App. **Lass diese Seite offen.**

## Schritt 2: Zwei IDs kopieren

Auf der Übersichtsseite der App siehst du oben zwei lange Nummern. Kopiere beide
in eine Notiz (Rechtsklick → Kopieren, oder das Kopier-Symbol daneben):

- **„Anwendungs-ID (Client)"** → das ist unsere **Angabe 1**
- **„Verzeichnis-ID (Mandant)"** → das ist unsere **Angabe 2**

## Schritt 3: Geheimen Schlüssel erstellen

1. Klicke links im App-Menü auf **„Zertifikate & Geheimnisse"**.
2. Klicke auf **„+ Neuer geheimer Clientschlüssel"**.
3. Beschreibung: `App-Sync`, Gültigkeit: **24 Monate** (730 Tage) auswählen.
4. Klicke **„Hinzufügen"**.
5. ⚠️ **SOFORT kopieren:** In der Tabelle erscheint eine Zeile mit zwei Spalten —
   kopiere den Inhalt der Spalte **„Wert"** (NICHT „Geheimnis-ID"!).
   Der Wert wird **nur jetzt einmal** angezeigt — wenn du die Seite verlässt,
   ist er weg und du müsstest einen neuen anlegen.
   → das ist unsere **Angabe 3**

## Schritt 4: Berechtigung erteilen

1. Klicke links im App-Menü auf **„API-Berechtigungen"**.
2. Klicke **„+ Berechtigung hinzufügen"**.
3. Wähle die große Kachel **„Microsoft Graph"**.
4. Wähle **„Anwendungsberechtigungen"** (NICHT „Delegierte Berechtigungen").
5. Tippe ins Suchfeld: `Files.ReadWrite.All`
6. Setze das Häkchen bei **Files.ReadWrite.All** und klicke unten
   **„Berechtigungen hinzufügen"**.
7. Zurück in der Liste: Klicke oben auf
   **„Administratorzustimmung für … erteilen"** und bestätige mit **„Ja"**.
   → In der Spalte „Status" muss jetzt ein **grüner Haken** stehen.

## Das schickst du uns zurück

| # | Angabe | Wo gefunden |
|---|--------|-------------|
| 1 | Anwendungs-ID (Client) | Schritt 2 |
| 2 | Verzeichnis-ID (Mandant) | Schritt 2 |
| 3 | Geheimer Schlüssel („Wert") | Schritt 3 |
| 4 | E-Mail-Adresse des Microsoft-365-Kontos, in dessen **OneDrive** die Projektordner liegen sollen | z. B. office@… |

**Tipp zur Sicherheit:** Schick Angabe 3 (den Schlüssel) am besten getrennt von
den anderen — z. B. die IDs per E-Mail und den Schlüssel per SMS/Anruf.

## Was danach passiert (macht ihr nichts mehr dafür)

Wir hinterlegen die Angaben, drücken auf „Verbindungstest", und ab dann
erscheint im angegebenen OneDrive automatisch der Ordner
**„Ruff Michael Projekte"** mit einem Unterordner pro Projekt
(Fotos, Pläne, Regieberichte, Material und alle eigenen Ordner).
Alles, was dort abgelegt oder geändert wird, landet automatisch auch in der
App — und umgekehrt. Der Abgleich läuft alle 10 Minuten.

Bei Fragen einfach melden — Christoph
