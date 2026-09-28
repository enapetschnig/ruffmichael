// Einheitliche Projektanzeige in der ganzen App:
// "Projektname – Kundenadresse" (Fallback: Projektadresse, dann PLZ).

export interface ProjectLike {
  name: string;
  plz?: string | null;
  adresse?: string | null;
  customers?: { strasse: string | null; ort: string | null } | null;
}

export const projectAddress = (p: ProjectLike): string => {
  if (p.customers) {
    const addr = [p.customers.strasse, p.customers.ort].filter(Boolean).join(", ").trim();
    if (addr) return addr;
  }
  if (p.adresse) return p.adresse;
  if (p.plz) return `PLZ ${p.plz}`;
  return "";
};

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");

/**
 * Steht die Adresse schon im Projektnamen („Fassl Grundäckergasse 14 Wien“ —
 * so werden Projekte seit 28.09.2026 benannt)? Dann nicht noch einmal anhängen.
 */
export const nameEnthaeltAdresse = (p: ProjectLike): boolean => {
  const strasse = (p.customers?.strasse || String(p.adresse ?? "").split(",")[0] || "").trim();
  return !!strasse && norm(p.name).includes(norm(strasse));
};

export const projectLabel = (p: ProjectLike): string => {
  const addr = nameEnthaeltAdresse(p) ? "" : projectAddress(p);
  return addr ? `${p.name} – ${addr}` : p.name;
};

/** Projektname nach Michaels Schema: Nachname (bzw. Firma), Straße, Ort. */
export const projektNameVorschlag = (teile: { nachname?: string | null; firma?: string | null; strasse?: string | null; ort?: string | null }) =>
  [teile.firma?.trim() || teile.nachname?.trim(), teile.strasse?.trim(), teile.ort?.trim()].filter(Boolean).join(" ");
