import { useState } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

/** Auswahlfeld mit Suche — 116 Kunden ohne Suche sind am Handy nicht bedienbar. */
export function Auswahl<T extends { id: string }>({ wert, optionen, label, suchtext, platzhalter, leer, onChange, onNeu }: {
  wert: string; optionen: T[]; label: (o: T) => string; suchtext: (o: T) => string; platzhalter: string; leer?: string; onChange: (id: string) => void;
  /** Wird angeboten, wenn die Suche nichts findet — z. B. „… als neuen Kunden anlegen“ */
  onNeu?: (suche: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [suche, setSuche] = useState("");
  const gewaehlt = optionen.find((o) => o.id === wert);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal h-11">
          <span className={cn("truncate", !gewaehlt && "text-muted-foreground")}>{gewaehlt ? label(gewaehlt) : platzhalter}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Tippen zum Suchen…" value={suche} onValueChange={setSuche} />
          <CommandList className="max-h-64">
            <CommandEmpty>
              {onNeu ? (
                <button type="button" className="w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-accent flex items-center gap-2" onClick={() => { onNeu(suche.trim()); setOpen(false); }}>
                  <UserPlus className="h-4 w-4 shrink-0" />{suche.trim() ? `„${suche.trim()}“ als neuen Kunden anlegen` : "Neuen Kunden anlegen"}
                </button>
              ) : "Nichts gefunden."}
            </CommandEmpty>
            <CommandGroup>
              {leer && (
                <CommandItem value="__leer__" onSelect={() => { onChange(""); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", wert ? "opacity-0" : "opacity-100")} />{leer}
                </CommandItem>
              )}
              {optionen.map((o) => (
                <CommandItem key={o.id} value={`${suchtext(o)} ${o.id}`} onSelect={() => { onChange(o.id); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", wert === o.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{label(o)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

