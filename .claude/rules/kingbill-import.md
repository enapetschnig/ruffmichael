---
paths:
  - "scripts/kingbill-*"
  - "src/lib/alleZeilen.ts"
  - "src/components/kingbill/**"
---
# KingBill-Import (Altbestand 2017–2026)

Am 21.09.2026 (Commit d72692a) die komplette KingBill-Datenbank importiert (Quelle:
`~/Downloads/wetransfer_kingbill_2026-09-21_1611.zip` → `KingBill-Sicherung_2026-09-21.king` = ZIP mit
`database/main.accdb`, 121 MB). Werkzeuge im Repo: `scripts/kingbill-export.py` (Access → JSON, braucht
`access_parser`) und `scripts/kingbill-import.mjs` (Probelauf ohne `--schreiben`; wiederholbar).

**Stand nach Import:** 1.650 Kunden (KingBill-Kundennummer in `customers.kundennr`), 438 Artikel, 6.628 Belege (1.074
Angebote, 2.754 Auftragsbestätigungen, 2.684 Rechnungen, 116 Gutschriften) mit 63.155 Positionen, 3.183 Zahlungen
(106 Skonto), 685 Eingangsrechnungen. Importierte Belege tragen die Notiz `Aus KingBill übernommen (R123, 2026-09-18)` —
daran erkennt das Skript sie. Nummernkreise danach: angebot 1158, **auftragsbestaetigung 3002 (eigener Kreis, Migration
20260921180000)**, rechnung 2689, gutschrift 118. Offen laut KingBill: 112 Rechnungen (36 aus 2025/26, 132 k€) —
Altbestand seit 2017, den Michael nie als bezahlt markiert hat; in der App unter „Offen".

**Access-Zahlenfallen (kosteten drei Anläufe):**
- Dezimalfelder (`Eingangsrechnung.Betrag*`, `Payment.Betrag/Skonto`) kommen aus access_parser als 17 Rohbytes: Byte 0
  Vorzeichen, dann 4 Little-Endian-Wörter in Big-Endian-Reihenfolge, **Skala 6**.
- Double-Felder als String „36.000000"; **Werte unter 1 verlieren das „0."** („500000" = 0,5 Std). Deshalb `betrag()`:
  Ganzzahl-String ohne Punkt → /1e6.
- 8 Positionen mit Milliardenwerten (kaputte Zeilen) → auf 0 gesetzt, Hinweis in der Beschreibung. Datumstippfehler wie
  „30.2.2022" → null.
- `DokumentAuftragPosition` bricht den Parser ab → `_parse_row` fehlertolerant gepatcht.
- KingBill selbst hat doppelte Kundennummer 1642 und doppelte Belegnummern (2022-1768, 2018-0266) → Suffix „b".
- Status: Rechnung 1 = bezahlt, 3 = offen; Angebot 3 = abgelehnt; Verkettung über `ActionLog`.

**Folgen für die App:** PostgREST-1000-Grenze → `alleZeilen()` überall, wo Kunden komplett geladen werden; Belegliste
sortiert nach datum, created_at, **id** (sonst Dubletten bei gleichem Zeitstempel).

**Nicht übernommen:** Original-PDFs (liegen in OneDrive, nicht verknüpft — die App rendert auf Knopfdruck neu im
KingBill-Layout), Mahnwesen, Kassenbuch (leer), 8 Kunden ohne Namen, Lieferantenstamm (15). Bei Rückfragen zu Beträgen
gilt die KingBill-Kopfsumme (`belege.netto/brutto` aus SummeNetto/SummeBrutto; 24 Belege weichen um Cent-Rundungen ab).
