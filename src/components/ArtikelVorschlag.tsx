import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type Artikel = {
  id: string;
  name: string;
  artikelnummer: string | null;
  einheit: string | null;
  verkaufspreis: number | null;
};

// Katalog einmal je Sitzung laden — er ändert sich selten, die Vorschläge
// müssen aber bei jedem Tastendruck sofort da sein.
let katalog: Artikel[] | null = null;
let katalogLaedt: Promise<Artikel[]> | null = null;
export async function ladeArtikelkatalog(neu = false): Promise<Artikel[]> {
  if (katalog && !neu) return katalog;
  if (katalogLaedt && !neu) return katalogLaedt;
  katalogLaedt = (async () => {
    const [{ data: m }, { data: p }] = await Promise.all([
      supabase.from("materials").select("id, name, artikelnummer, einheit, is_active").eq("is_active", true).order("name"),
      supabase.from("material_prices").select("material_id, verkaufspreis"),
    ]);
    const preise = new Map((p ?? []).map((x) => [x.material_id, x.verkaufspreis == null ? null : Number(x.verkaufspreis)]));
    katalog = (m ?? []).map((x) => ({ id: x.id, name: x.name, artikelnummer: x.artikelnummer ?? null, einheit: x.einheit ?? null, verkaufspreis: preise.get(x.id) ?? null }));
    return katalog;
  })();
  return katalogLaedt;
}
export const artikelkatalogVergessen = () => { katalog = null; katalogLaedt = null; };

const norm = (s: string) => s.toLowerCase().replace(/ß/g, "ss").replace(/[äöü]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue" }[c] ?? c));

/** Findet Artikel, deren Name oder Artikelnummer alle getippten Wortteile enthält. */
export function artikelSuchen(liste: Artikel[], text: string, max = 10): Artikel[] {
  const q = norm(text.trim());
  if (q.length < 1) return [];
  const teile = q.split(/\s+/).filter(Boolean);
  const treffer = liste
    .map((a) => {
      const n = norm(a.name), nr = (a.artikelnummer ?? "").toLowerCase();
      if (!teile.every((t) => n.includes(t) || nr.includes(t))) return null;
      // Ranking: Artikelnummer exakt > Name beginnt mit > Wort beginnt mit > enthält
      const rang = nr === q ? 0 : n.startsWith(q) ? 1 : n.split(/\s+/).some((w) => w.startsWith(teile[0])) ? 2 : 3;
      return { a, rang };
    })
    .filter((x): x is { a: Artikel; rang: number } => !!x)
    .sort((x, y) => x.rang - y.rang || x.a.name.localeCompare(y.a.name));
  return treffer.slice(0, max).map((x) => x.a);
}

const eur = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(n));

interface Props {
  value: string;
  onChange: (text: string) => void;
  onBlur?: (text: string) => void;
  /** Ein Artikel aus dem Katalog wurde gewählt — Name, Einheit und Preis übernehmen. */
  onSelect: (artikel: Artikel) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Bezeichnungsfeld einer Position mit Vorschlägen aus dem Artikelkatalog:
 * beim Tippen erscheinen passende Artikel (Name oder Art.-Nr.), Pfeiltasten
 * + Enter oder ein Tipp übernehmen Name, Einheit und Verkaufspreis.
 */
export function ArtikelVorschlag({ value, onChange, onBlur, onSelect, disabled, placeholder, className }: Props) {
  const [liste, setListe] = useState<Artikel[]>(() => katalog ?? []);
  const [offen, setOffen] = useState(false);
  const [aktiv, setAktiv] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => { ladeArtikelkatalog().then(setListe); }, []);

  const treffer = useMemo(() => (offen ? artikelSuchen(liste, value) : []), [liste, value, offen]);
  useEffect(() => { setAktiv(0); }, [value]);

  const waehlen = (a: Artikel) => {
    onSelect(a);
    setOffen(false);
  };

  return (
    <div ref={wrap} className="relative">
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={offen && treffer.length > 0}
        aria-autocomplete="list"
        onChange={(e) => { onChange(e.target.value); setOffen(true); }}
        onFocus={() => setOffen(true)}
        onBlur={(e) => { window.setTimeout(() => setOffen(false), 150); onBlur?.(e.target.value); }}
        onKeyDown={(e) => {
          if (!offen || treffer.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setAktiv((i) => Math.min(i + 1, treffer.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAktiv((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); waehlen(treffer[aktiv]); }
          else if (e.key === "Escape") { setOffen(false); }
        }}
      />
      {offen && treffer.length > 0 && (
        <ul role="listbox" className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md py-1">
          {treffer.map((a, i) => (
            <li
              key={a.id}
              role="option"
              aria-selected={i === aktiv}
              onMouseDown={(e) => { e.preventDefault(); waehlen(a); }}
              onMouseEnter={() => setAktiv(i)}
              className={cn("px-3 py-2 text-sm cursor-pointer flex items-center gap-2", i === aktiv && "bg-accent")}
            >
              <span className="flex-1 min-w-0 truncate">{a.name}</span>
              {a.artikelnummer && <span className="text-xs text-muted-foreground shrink-0">Nr. {a.artikelnummer}</span>}
              <span className="text-xs tabular-nums shrink-0">{a.verkaufspreis != null ? `${eur(a.verkaufspreis)}${a.einheit ? ` / ${a.einheit}` : ""}` : a.einheit ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
