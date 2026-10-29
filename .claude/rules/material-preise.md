---
paths:
  - "src/pages/MaterialCatalog.tsx"
  - "src/pages/MaterialList.tsx"
  - "src/pages/Nachtraege.tsx"
  - "src/components/MaterialPicker.tsx"
  - "src/components/NachtragDialog.tsx"
  - "src/components/DisturbanceMaterials.tsx"
---
# Material, Preise, Nachträge

## Preise nur Admin
Mitarbeiter dürfen NIE Preise sehen (Material-Einkaufs-/Verkaufspreise), nur der Administrator. **Why:**
Einkaufspreise/Kalkulation sind Betriebsgeheimnis gegenüber Mitarbeitern.

Preise liegen in eigener Tabelle `material_prices` mit Admin-only-RLS (Enforcement in der DB, nicht nur UI); die
`materials`-Tabelle selbst enthält keine Preisspalten. Bei allen neuen Features, die Materialien anzeigen
(Arbeitsbestätigungen, Nachträge, Picker, Exporte, PDFs), niemals `material_prices` für Nicht-Admins abfragen oder Preise
rendern.

## Materialkatalog
- 30.07.2026: Die `materials`-Tabelle wurde komplett geleert: 150 fachfremde Einträge (Holzbau/Dachdecker – „Entsorgung
  Bitumen", „Konstruktionsholz", „Baumeisterstunde" …) samt `material_prices` gelöscht. Sie passten nicht zu einem
  Installateur (Wärme/Kälte/Regelung).
- 07.09.2026: 249 Artikel aus Michaels Angebots-/Rechnungs-PDFs importiert, danach auf **207 reine Materialartikel**
  bereinigt (Arbeitsleistungen raus, Christoph: „nur Materialien, keine Arbeitszeit“). Arbeitszeit gehört ausschließlich
  in die Faktura-Stundensätze. Rückgängig: `delete from materials where quelle='import-onedrive'`.
- Doppelklick-Schutz beim Speichern (`if (saving) return`, 21.09.2026).
