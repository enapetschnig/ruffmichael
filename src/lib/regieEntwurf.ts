// Entwurf eines NEUEN Regieberichts — auf dem Gerät gesichert, bei jeder Eingabe.
// Übersteht Schließen des Fensters, Wegtippen, Handy-Sperre, Absturz und fehlendes
// Internet. Erst nach erfolgreichem Speichern wird der Entwurf gelöscht.
// (Bereits gespeicherte Berichte liegen in der Datenbank — dafür braucht es keinen Entwurf.)

const SCHLUESSEL = "regiebericht-entwurf:neu";

export type RegieEntwurf<F = Record<string, unknown>, M = unknown> = {
  formData: F;
  selectedEmployees: string[];
  materials: M[];
  gespeichertAm: string;
};

export function ladeRegieEntwurf<F, M>(): RegieEntwurf<F, M> | null {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    return roh ? (JSON.parse(roh) as RegieEntwurf<F, M>) : null;
  } catch {
    return null;
  }
}

export function speichereRegieEntwurf<F, M>(e: Omit<RegieEntwurf<F, M>, "gespeichertAm">) {
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify({ ...e, gespeichertAm: new Date().toISOString() }));
    window.dispatchEvent(new Event("regiebericht-entwurf"));
  } catch { /* Speicher voll/gesperrt — dann eben ohne Entwurf */ }
}

export function loescheRegieEntwurf() {
  try {
    localStorage.removeItem(SCHLUESSEL);
    window.dispatchEvent(new Event("regiebericht-entwurf"));
  } catch { /* egal */ }
}

/** Steht etwas Sinnvolles drin? Leere Formulare werden nicht als Entwurf gesichert. */
export const hatInhalt = (f: { kundeName?: string; kundeAdresse?: string; kundeTelefon?: string; kundeEmail?: string; beschreibung?: string; notizen?: string }, materials: { material?: string }[]) =>
  !!(f.kundeName?.trim() || f.kundeAdresse?.trim() || f.kundeTelefon?.trim() || f.kundeEmail?.trim() || f.beschreibung?.trim() || f.notizen?.trim() || materials.some((m) => m.material?.trim()));
