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

export const projectLabel = (p: ProjectLike): string => {
  const addr = projectAddress(p);
  return addr ? `${p.name} – ${addr}` : p.name;
};
