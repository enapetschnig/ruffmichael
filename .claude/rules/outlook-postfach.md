---
paths:
  - "src/pages/Postfach.tsx"
  - "src/pages/Eingangsrechnungen.tsx"
  - "src/pages/Kalender.tsx"
  - "src/lib/postfach.ts"
  - "src/components/MailSenden.tsx"
  - "src/components/MailZuProjekt.tsx"
  - "src/components/TermineHeute.tsx"
  - "supabase/functions/outlook/**"
---
# Outlook: E-Mail, Eingangsrechnungen, Kalender

Seit 10.09.2026 live (Commit b937867; Wunsch Michael 09.09.: „kann man Kalender und Mail einbinden“): Menüpunkt „E-Mail"
(`/postfach`), `/eingangsrechnungen` und `/kalender` — alles nur für Administratoren (RLS `has_role(... 'administrator')`).

**Microsoft-Anbindung:** dieselbe App-Registrierung wie der OneDrive-Sync, zusätzlich als Anwendungsberechtigungen
`Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite.All` (plus `Files.ReadWrite.All`). **`User.Read.All` fehlt bewusst**
— `/users/{upn}` liefert 403, das ist kein Fehler. Postfach über `MS_MAIL_TARGET` (Rückfall `MS_DRIVE_TARGET`) =
office@ruffinstallateur.at. Eine `New-ApplicationAccessPolicy` (Beschränkung auf dieses Postfach) wurde empfohlen, aber
noch NICHT gesetzt.

**⛔ Feste Regel (Christoph, 10.09.2026): In Outlook wird nichts verändert.** Die Function `outlook` kennt für vorhandene
Mails und Termine keinen PATCH/DELETE — nur GET. Einziger schreibender Weg ist `sendMail` (neue Mail). „gelesen"/
„erledigt" und die Projektzuordnung führt die App für sich. Kalender ist reine Anzeige.

**Erkennung von Eingangsrechnungen:** erst Regeln (Betreff/Anhangsname), bei Verdacht `gpt-4.1-mini` mit JSON-Schema über
Absender + Betreff + Mailtext + **PDF-Text** (`unpdf`). Ergebnis steht immer auf Status „offen" = zu prüfen; Michael gibt
frei. Gesendete Mails werden nie zur Eingangsrechnung. Aus `mahnung` entsteht NIE eine Eingangsrechnung, Post von einem
eingetragenen Kunden (`mails.kunde_id`) auch nicht. Gleiche `nummer` + gleicher Lieferant ⇒ übersprungen.

**Fallen:**
- Supabase-Storage-Schlüssel vertragen **kein Umlaut/Sonderzeichen** → `sauber()` mit Transliteration; angezeigt wird der
  Originalname aus `mail_anhaenge.name`. Nachträglich reparieren: Aktion `anhaenge_nachholen`.
- Ordner „Konflikte"/„Synchronisierungsprobleme" sind Outlook-Systemordner → in `ORDNER_AUS` ausgeschlossen.
- Inline-Bilder (image001.png aus Signaturen) nie als Anhang speichern (`a.isInline`).
- **In Edge Functions nie den Service-Schlüssel per Zeichenvergleich erkennen** (Cron lieferte 10.–21.09. 401, weil der
  JWT im Cron-Job nicht zeichengleich mit dem Env-Wert war). Jetzt: Rolle aus dem Token lesen + per RLS-Probe prüfen.
  Prüfen, ob es klemmt: `net._http_response` (nur ~6 h Vorrat) oder `mail_sync_state.letzter_lauf` — der Cron selbst
  meldet immer „succeeded".

**Zeitplan:** pg_cron `outlook-mail-sync` alle **5** Minuten (auch beim Öffnen und im Hintergrund, 21.09.2026). Erster Lauf
holt 60 Tage, danach ab letztem Lauf minus 2 Tage, in 90-Sekunden-Häppchen (`offen: true` = nochmal aufrufen). Was in
Outlook im Papierkorb/Junk landet, wird in der App gelöscht — in Outlook selbst wird nichts angefasst.

**Mailversand:** über das Firmenpostfach, Kopie in Michaels „Gesendete Elemente". Belege: Knopf „Per Mail". Resend wird
nicht mehr gebraucht. Tabellen: `mails`, `mail_anhaenge`, `eingangsrechnungen`, `mail_sync_state`; Bucket
`mail-anhaenge` (privat, Admin).
