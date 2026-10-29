---
paths:
  - "src/pages/Belege.tsx"
  - "src/pages/BelegDetail.tsx"
  - "src/lib/faktura.ts"
  - "src/components/Beleg*"
  - "src/components/ArtikelVorschlag.tsx"
  - "src/components/FakturaEinstellungen.tsx"
  - "src/components/kingbill/**"
  - "supabase/functions/beleg-pdf/**"
---
# Angebote & Rechnungen (Faktura)

Seit 2026-09-02 ist Stufe 1 des Rechnungsmoduls live (Routen `/belege`, `/belege/:id`, Admin-Abschnitt „Einstellungen“,
nur Administratoren). Konzept-Artefakt: https://claude.ai/code/artifact/1a4f5c82-154b-446e-9701-b8a67a41a5b4

**Feste Regeln (bewusst so gebaut):**
- Nummer erst beim Festschreiben (`beleg_festschreiben`), danach unveränderbar; Korrektur nur per Gutschrift
  (`beleg_stornieren`). Festgeschriebene Belege sind auch für Admins nicht löschbar (Trigger).
- Nummernkreise laufen wie bei Michael: getrennt je Belegart, über Jahre durch, Jahr als Präfix. Stand nach dem
  KingBill-Import (21.09.2026): angebot 1158, auftragsbestaetigung 3002 (eigener Kreis), rechnung 2689, gutschrift 118.
- PDF festgeschriebener Belege → `project-files/{projekt}/Anbote/…` (Michaels Ordnername) → OneDrive-Sync. Entwürfe nur
  als Vorschau, nie abgelegt. Belege ohne Projekt landen unter `_ohne_projekt/` (wird nicht gesynct).
- Kunden mit festgeschriebener Rechnung/Belegen lassen sich nicht löschen (Trigger mit klarer Meldung).

**v2 (2026-09-02):** Angebote nach Festschreiben wieder bearbeitbar (Status → entwurf, Nummer bleibt), Nummernformat je
Kreis (praefix/jahr_format/trenner/breite, `faktura_nummer_bauen`), Kundenkarte zeigt Belege (`faktura_kunden_summen`).
Belege mit Nummer sind nie löschbar, auch Angebote nicht.

**v3 Härtung (2026-09-02, Commit 126a6a7):** Ordner „Anbote“ im Bucket project-files nur für Admins; Stunden markieren
NUR über `faktura_stunden_markieren` (Client-UPDATE auf fremde time_entries scheitert still an RLS!);
Schreibschutz-Whitelist; Storno wirkt erst beim Festschreiben der Gutschrift; Pflichtangaben + Datumsreihenfolge beim
Festschreiben; gesendete Rechnungs-PDFs werden nie neu gerendert. Zahlenfelder in der Oberfläche sind Textfelder mit
Komma (`parseZahl`, versteht seit 10.09. deutsch/englisch/NBSP; `zahl()` liefert bei de-AT ein geschütztes Leerzeichen
U+00A0 als Tausendertrenner).

**Stufe v5 (07.09.2026, Commit f55f0d5):** PDF im KingBill-Aufbau (Vorlage: Michaels „Unverbindliches Angebot 2026-1111“,
Kundeninfo-Kasten, Übertrag, Bankverbindung-Fußzeile, Auftragsbedingungen/Zahlung/Unterschriften/FAGG-Widerruf als
Firmendaten-Texte `angebot_bedingungen`/`angebot_zahlung`/`angebot_widerruf`, Schalter `angebot_widerruf_zeigen`;
Firmendaten in `faktura_firmendaten`). Editor: Eingabe links, Vorschau rechts ab 1280 px (Reiter am Handy).
„Regieberichte holen“: `disturbances.abgerechnet_in`, RPCs `faktura_offene_regieberichte` /
`faktura_regieberichte_markieren`, Material kommt mit Preis 0 (gelb). „Rechnung erstellen“ aus Angebot mit
Positionsauswahl + Rechnung/Teilrechnung. Stundensätze Monteur 82 / Service Monteur 97 / Partie 164.

**Nachtrag 07.09. (Commit fb616ae):** Vorschau ist KEIN PDF-Iframe mehr, sondern `src/components/BelegBlatt.tsx` —
HTML-Spiegel des PDF-Layouts aus dem lokalen Editor-Zustand, Summen lokal gerechnet. **Wer das PDF-Layout in
`beleg-pdf/index.ts` ändert, muss BelegBlatt nachziehen (zwei Renderer, ein Aussehen).** Echtes PDF nur auf Knopf
„PDF · Teilen · Drucken“ und beim Festschreiben. „Neuer Beleg“ kann Kunden direkt anlegen.

**Belegablauf + Export 07.09.2026 (Commit 9c2a014):** Knopf heißt „Angebot/Rechnung/Gutschrift erstellen“ (RPC bleibt
`beleg_festschreiben`), Status-Label „Erstellt“; Entwurf aus einem Angebot heißt „Rechnung vorbereiten“. Angebote sind
immer bearbeitbar (auch „Angenommen“). Storno: „Stornieren“ → Gutschrift-Entwurf, an der Rechnung „Storno fortsetzen“.
`src/components/BelegExport.tsx`: Monat/Jahr/alles/von–bis, Belegarten, Excel (Blatt „Belege“ 18 Spalten inkl. „davon
Skonto“, Gutschriften negativ; Blatt „Positionen“), PDF-Paket als ZIP. Belegliste lädt seitenweise, sortiert nach
Nummer (neueste zuerst, Entwürfe oben; 22.09.2026).

**Mailversand** von Belegen über Outlook (Knopf „Per Mail“ in `/belege/:id`, setzt `belege.gesendet_am` + Status
„gesendet“) – siehe `outlook-postfach.md`.

**Artikelkatalog:** 207 reine Materialartikel aus Michaels OneDrive-PDFs (`materials.quelle = 'import-onedrive'`),
Arbeitsleistungen bewusst entfernt (Christoph: „nur Materialien, keine Arbeitszeit“). Namensvorschläge von Agenten nie
direkt übernehmen (kamen ASCII-transliteriert zurück: Wärmepumpe → Waermepumpe). Einheiten wie in Michaels Belegen
(Stk, Std, lfm, Liter, Tage) – Stunden heißen überall „Std“.

**Offen (Stufe 2, Stand 02.09.):** Material holen mit Artikelstamm (menge ist Text!), Nachträge mit Positionen/Preis,
Übernahme → Schlussrechnung-Hinweis, Mahnwesen.
