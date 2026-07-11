import { useEffect, useMemo, useState } from "react";
import { Package, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

// WICHTIG: Diese Komponente wird von Mitarbeitern verwendet.
// Es dürfen hier NIEMALS Preise geladen oder angezeigt werden.

export interface CatalogMaterial {
  id: string;
  name: string;
  einheit: string | null;
  kategorie: string;
}

interface MaterialPickerProps {
  onSelect: (material: CatalogMaterial) => void;
  triggerLabel?: string;
}

export function MaterialPicker({ onSelect, triggerLabel }: MaterialPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [materials, setMaterials] = useState<CatalogMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open || loaded) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("materials")
        .select("id, name, einheit, kategorie")
        .eq("is_active", true)
        .order("kategorie")
        .order("name");
      setMaterials(data ?? []);
      setLoaded(true);
      setLoading(false);
    })();
  }, [open, loaded]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) =>
      [m.name, m.kategorie, m.einheit]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [materials, search]);

  const handleSelect = (material: CatalogMaterial) => {
    onSelect(material);
    setOpen(false);
    setSearch("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Package className="h-4 w-4" />
          {triggerLabel ?? "Material aus Katalog"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg p-0 gap-0">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Material aus Katalog wählen
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Material suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto border-t">
          {loading ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              Lade Materialien...
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              {materials.length === 0
                ? "Keine Materialien im Katalog."
                : "Keine Treffer."}
            </p>
          ) : (
            <div className="divide-y">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent focus:bg-accent focus:outline-none transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{m.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {m.kategorie}
                    </div>
                  </div>
                  {m.einheit && (
                    <Badge variant="secondary" className="shrink-0">
                      {m.einheit}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
