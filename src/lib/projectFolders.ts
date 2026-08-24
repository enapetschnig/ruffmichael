// Einzige Quelle der Wahrheit für die festen Kategorie-Ordner eines Projekts.
// Diese Ordner sind jeweils an einen eigenen Supabase-Storage-Bucket gebunden.
//
// - Fotos, Regieberichte, Pläne, Material können pro Projekt vom Admin an-/
//   abgeschaltet werden (projects.hidden_categories).
// - Chef ist NICHT abschaltbar: immer vorhanden, aber nur für Admins sichtbar.
//
// Reihenfolge in der Projekt-Übersicht (laut Vorgabe):
//   Fotos → Regieberichte → (selbst erstellte Ordner) → Pläne → Material → Chef

export type FolderCategory = "photos" | "reports" | "plans" | "materials" | "chef";

// Standardordner, die beim Anlegen eines Projekts erzeugt werden.
//
// Diese Liste entspricht der TATSÄCHLICH GELEBTEN Ordnerstruktur von Michael
// Ruff in OneDrive (ausgezählt über 44 echte Projektordner aus 2025/2026):
// Abnahme Protokoll 42x, Programmierung 38x, Anbote/Anleitungen/Doko/Mail je 36x.
// "Fotos" und "Plan" fehlen hier bewusst — die kommen als Kategorie-Kacheln
// (project-photos / project-plans) und würden sonst doppelt entstehen.
// Frühere App-Ordner "Beschreibung"/"Hydraulik" wurden entfernt: in nur 2 von
// 44 Projekten benutzt. "Foto" (Einzahl) war ein Namensfehler — er schreibt "Fotos".
export const STANDARD_PROJECT_FOLDERS = [
  "Abnahme Protokoll",
  "Anbote",
  "Anleitungen",
  "Doko",
  "Mail",
  "Programmierung",
];

// Reihenfolge der festen Kacheln. Die selbst erstellten Ordner werden im
// Overview NACH "reports" (Regieberichte) und VOR "plans" eingefügt.
export const CATEGORY_ORDER: FolderCategory[] = [
  "photos",
  "reports",
  "plans",
  "materials",
  "chef",
];

// Position (Index in CATEGORY_ORDER), nach der die selbst erstellten Ordner
// eingeschoben werden – hier nach "reports".
export const CUSTOM_FOLDERS_AFTER: FolderCategory = "reports";

// Vom Admin pro Projekt an-/abschaltbar (Chef bewusst NICHT enthalten).
export const TOGGLEABLE_CATEGORIES: FolderCategory[] = [
  "photos",
  "reports",
  "plans",
  "materials",
];

export const CATEGORY_LABELS: Record<FolderCategory, string> = {
  photos: "Fotos",
  reports: "Regieberichte",
  plans: "Pläne",
  materials: "Material",
  chef: "Chefordner",
};

export const CATEGORY_DESCRIPTIONS: Record<FolderCategory, string> = {
  photos: "Baufortschritt und Dokumentationsfotos",
  reports: "Bautagebücher und Stundenberichte",
  plans: "Baupläne und technische Zeichnungen",
  materials: "Verwendete Materialien dokumentieren",
  chef: "Vertrauliche Chef-Dokumente",
};

// Storage-Bucket je Kategorie. "materials" hat KEINEN Bucket – die Materialliste
// wird aus der DB-Tabelle material_entries gezählt und separat verwaltet.
export const CATEGORY_BUCKETS: Partial<Record<FolderCategory, string>> = {
  photos: "project-photos",
  plans: "project-plans",
  reports: "project-reports",
  chef: "project-chef",
};

// Ist eine Kategorie in einem Projekt sichtbar?
export function isCategoryVisible(
  cat: FolderCategory,
  hidden: string[] | null | undefined,
  isAdmin: boolean,
): boolean {
  if (cat === "chef") return isAdmin; // Chef: immer vorhanden, nur für Admins
  return !(hidden ?? []).includes(cat);
}
