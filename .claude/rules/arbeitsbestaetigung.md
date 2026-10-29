---
paths:
  - "src/pages/Disturbance*"
  - "src/components/Disturbance*"
  - "src/components/SignatureDialog.tsx"
  - "src/lib/regiebericht.ts"
  - "src/lib/regieEntwurf.ts"
  - "src/lib/pdfDrucken.ts"
  - "supabase/functions/send-disturbance-report/**"
---
# Arbeitsbestätigung (Regiebericht, `disturbances`)

- **Umbenennung 04.10.2026 (Commit eee602c, Function v10):** Auf Wunsch Michaels (Rechtsanwalt) heißt der Regiebericht
  nach außen „Auftrag und Arbeitsbestätigung für Regieleistung“ (PDF, Mail, Unterschriftsfenster mit Text „erteile
  Auftrag … bestätige Durchführung“), in der App „Aufträge & Arbeitsbestätigungen“ / „Arbeitsbestätigung“. Code,
  Tabellen (`disturbances`), Route `/disturbances`, `taetigkeit`-Text „Regiebericht: …“ und OneDrive-Ordner
  „Regieberichte“ bewusst unverändert.
- **PDF wie Papierformular (05.10.2026, Function v11):** `generatePDF` in send-disturbance-report baut Michaels Formular
  „AUFTRAG UND ARBEITSBESTÄTIGUNG für REGIELEISTUNG“ nach (Kopf aus `faktura_firmendaten`, Tabelle 8 Zeilen + Gesamt,
  ACHTUNG-Text wörtlich vom Formular, Material-Linien, Datum/Unterschrift). **Unterschrift nur an einer Stelle** (unten
  bei Datum/Unterschrift, Christoph 05.10.). jsPDF-Standardschrift kennt „−“/„′“ nicht → nur ASCII/WinAnsi. Lokal testen
  ohne Deploy: generatePDF-Abschnitt per tsx + npm-jspdf rendern. Kundenname wird am letzten Leerzeichen in Vor-/Nachname
  geteilt (Firmen ganz in Nachname).
- **Versand über Outlook (28.09.2026, Commit 5030a19):** schickt per Graph aus office@ruffinstallateur.at an den Kunden
  (sonst office@), CC IMMER office@ + `app_settings.disturbance_report_email` (seit 01.10.2026 = office@ruffinstallateur.at;
  vorher Christophs Adresse). Resend ist raus. Knopf „Bericht senden“ für unterschrieben+offen. Hängengebliebene echte
  Berichte werden NICHT automatisch nachgeschickt.
- **Drucken auch unsigniert** (Modus `nurPdf`, kein Versand); Direktdruck `lib/pdfDrucken.ts` (pdf.js → Bilder →
  window.print; iframe.print druckt am iPhone nur Seite 1). Aus der Arbeitsbestätigung schnell eine Wartung eintragen.
- **Entwurf (28.09.2026, Commit 9e1ed66):** neue Berichte werden laufend in `localStorage["regiebericht-entwurf:neu"]`
  gesichert (`lib/regieEntwurf.ts`), nur auf DEM Gerät, nur neue Berichte. Gelöscht erst nach erfolgreichem Speichern.
- Pause in Arbeitsbestätigungen nur, wenn diktiert/eingegeben (Kundenverrechnung) – Ausnahme von der Pausenregel.
- Abrechnung: `disturbances.abgerechnet_in` („Regieberichte holen“ in der Rechnung).
