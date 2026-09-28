// Postleitzahl — eine Stelle für alle Masken, die Projekte anlegen oder ändern
// (Projektliste, Zeiterfassung, Erstaufnahme, Projekt bearbeiten).
//
// Früher prüfte jede Maske streng /^\d{4,5}$/ auf das eigene Feld. Dadurch
// scheiterte die Anlage, obwohl die PLZ längst da war: im Kundenfeld direkt
// darüber, als „A-2700“, als „2700 Wiener Neustadt“ oder per Sprache im Ort.

/** Findet eine 4- bis 5-stellige PLZ in beliebigem Text („2700“, „A-2700“, „2700 Wr. Neustadt“). */
export const plzAus = (text: string | null | undefined): string => {
  // Kein Lookbehind (?<!…) — ältere iPhones (vor iOS 16.4) kennen ihn nicht und die ganze App bliebe weiß.
  const m = String(text ?? "").match(/(?:^|\D)(\d{4,5})(?!\d)/);
  return m ? m[1] : "";
};

/** Für das Eingabefeld: nur Ziffern, höchstens 5 — eingefügte „A-2700 Ort“ werden zu „2700“. */
export const plzEingabe = (wert: string): string =>
  plzAus(wert) || wert.replace(/\D/g, "").slice(0, 5);

/**
 * Die PLZ, mit der das Projekt gespeichert wird: zuerst das Projektfeld,
 * sonst die PLZ des Kunden (eigenes Feld oder aus „PLZ Ort“ gelesen).
 */
export const projektPlz = (feld: string, ...kunde: (string | null | undefined)[]): string =>
  plzAus(feld) || kunde.map(plzAus).find(Boolean) || "";

export const PLZ_FEHLT =
  "Bitte die Postleitzahl eingeben (4 oder 5 Ziffern, z. B. 2700) — oder einen Kunden mit Adresse wählen, dann wird sie übernommen.";
