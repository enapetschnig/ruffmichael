import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, Phone, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";
import { getSessionUser } from "@/lib/auth";
import { fetchCustomersCached } from "@/lib/cachedQueries";
import { newId, saveInsert } from "@/lib/offlineData";
import { plzAus } from "@/lib/plz";
import { cn } from "@/lib/utils";
import { CustomerFormFields, customerFormToRow, emptyCustomerForm } from "@/pages/Customers";

export type Kunde = Database["public"]["Tables"]["customers"]["Row"];

/** „Firma“ bzw. „Vorname Nachname“ — so heißt der Kunde überall in der App. */
export const kundeName = (k: Pick<Kunde, "firma" | "vorname" | "nachname">) =>
  k.firma?.trim() || [k.vorname, k.nachname].filter(Boolean).join(" ").trim();

/** Adresse des Kunden, aufgeteilt für Projektfelder. */
export const kundeAdresse = (k: Pick<Kunde, "strasse" | "ort"> | null | undefined) => {
  const ortText = String(k?.ort ?? "").trim();
  const plz = plzAus(ortText);
  return {
    strasse: String(k?.strasse ?? "").trim(),
    plz,
    // „2700 Wiener Neustadt“ / „A-2700 Wiener Neustadt“ → „Wiener Neustadt“
    ort: ortText.replace(/^\s*(?:[A-Z]{1,2}-)?\d{4,5}\s*/, "").trim(),
  };
};

// Für die Suche: klein, ohne Umlaute/Akzente — „Müller“ findet „mueller“ und umgekehrt
const norm = (s: string) =>
  s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");

const suchtext = (k: Kunde) =>
  norm([k.kundennr, k.firma, k.vorname, k.nachname, k.strasse, k.ort, k.telefon, k.mobil, k.email].filter(Boolean).join(" "));

// Einmal geladen, für alle Auswahlfelder der Sitzung — 1.650 Kunden nicht bei jedem Dialog neu holen
let zwischenspeicher: Kunde[] | null = null;
const zuhoerer = new Set<(l: Kunde[]) => void>();
const setzeSpeicher = (l: Kunde[]) => { zwischenspeicher = l; zuhoerer.forEach((f) => f(l)); };
let laedt: Promise<void> | null = null;
function ladeKunden(neu = false) {
  if (laedt && !neu) return laedt;
  laedt = fetchCustomersCached().then(({ data }) => {
    if (data) setzeSpeicher(data as unknown as Kunde[]);
  }).finally(() => { laedt = null; });
  return laedt;
}

/** Alle Kunden (geteilt) — für Seiten, die die Liste selbst brauchen. */
export function useKunden() {
  const [liste, setListe] = useState<Kunde[]>(zwischenspeicher ?? []);
  useEffect(() => {
    zuhoerer.add(setListe);
    ladeKunden(true);
    return () => { zuhoerer.delete(setListe); };
  }, []);
  return liste;
}

/**
 * DIE Kundenauswahl der App — in Projekten, Erstaufnahme, Belegen und Wartungen gleich.
 * Suchen nach Name, Firma, Ort, Straße, Telefon oder Kundennummer; wer fehlt,
 * wird direkt hier angelegt (auch offline) und ist sofort gewählt.
 */
export function KundenAuswahl({ wert, onChange, zeigeRechnungsdaten = false, pflicht = false, className, neuVorlage, startSuche }: {
  wert: string | null | undefined;
  /** Öffnet „Neuer Kunde“ vorausgefüllt (z. B. aus der Spracheingabe) — bei jeder neuen Vorlage */
  neuVorlage?: Partial<typeof emptyCustomerForm> | null;
  /** Suchfeld vorbelegen (z. B. Kundenname aus einem Regiebericht) */
  startSuche?: string;
  onChange: (kunde: Kunde | null) => void;
  /** Rechnungsdaten (UID, Reverse Charge …) beim Neuanlegen zeigen — nur Admin/Belege */
  zeigeRechnungsdaten?: boolean;
  pflicht?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const kunden = useKunden();
  const [suche, setSuche] = useState(startSuche ?? "");
  const [offen, setOffen] = useState(false);
  const [neu, setNeu] = useState<typeof emptyCustomerForm | null>(null);
  const [speichert, setSpeichert] = useState(false);
  // Frisch angelegt, aber noch nicht in der geladenen Liste (offline/Verzögerung)
  const [extra, setExtra] = useState<Kunde | null>(null);
  const eingabe = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!neuVorlage) return;
    // „2700 Wiener Neustadt“ im Ort (Sprache) → PLZ und Ort getrennt
    const a = kundeAdresse({ strasse: neuVorlage.strasse ?? "", ort: neuVorlage.ort ?? "" });
    setNeu({ ...emptyCustomerForm, ...neuVorlage, plz: neuVorlage.plz || a.plz, ort: a.ort || neuVorlage.ort || "" });
  }, [neuVorlage]);

  const gewaehlt = wert ? kunden.find((k) => k.id === wert) ?? (extra?.id === wert ? extra : null) : null;

  const treffer = useMemo(() => {
    const worte = norm(suche).split(/\s+/).filter(Boolean);
    if (!worte.length) return [];
    const out: Kunde[] = [];
    for (const k of kunden) {
      const t = suchtext(k);
      if (worte.every((w) => t.includes(w))) out.push(k);
      if (out.length >= 30) break;
    }
    return out;
  }, [kunden, suche]);

  const waehlen = (k: Kunde | null) => {
    onChange(k);
    setSuche("");
    setOffen(false);
  };

  const neuStarten = () => {
    // Suchbegriff sinnvoll vorbelegen: „Müller GmbH“ → Firma, Zahlen → Telefon, sonst Nachname
    const f = { ...emptyCustomerForm };
    const s = suche.trim();
    if (/gmbh|\bog\b|\bkg\b|\bag\b|e\.u\.|gesmbh/i.test(s)) { f.firma = s; f.ist_unternehmer = true; }
    else if (/^[+\d\s/-]{6,}$/.test(s)) f.telefon = s;
    else if (s) {
      const teile = s.split(/\s+/);
      if (teile.length > 1) { f.vorname = teile.slice(0, -1).join(" "); f.nachname = teile[teile.length - 1]; } else f.nachname = s;
    }
    setNeu(f);
    setOffen(false);
  };

  const neuSpeichern = async () => {
    if (!neu || speichert) return;
    if (!neu.nachname.trim() && !neu.firma?.trim()) {
      return toast({ variant: "destructive", title: "Name fehlt", description: "Bitte Nachname (bei Firmen die Firma) eingeben." });
    }
    const row = customerFormToRow({ ...neu, nachname: neu.nachname.trim() || (neu.firma ?? "").trim() });
    // Gibt es den schon? Gleicher Name + gleicher Ort → nicht doppelt anlegen
    const doppelt = kunden.find((k) => norm(kundeName(k)) === norm(kundeName(row as Kunde)) && norm(k.ort ?? "") === norm(row.ort ?? ""));
    if (doppelt) {
      toast({ title: "Kunde gibt es schon", description: `${kundeName(doppelt)} wurde ausgewählt.` });
      setNeu(null);
      return waehlen(doppelt);
    }
    setSpeichert(true);
    const user = await getSessionUser();
    const id = newId();
    const r = await saveInsert("customers", { ...row, id, created_by: user?.id ?? null }, `Kunde ${kundeName(row as Kunde)}`);
    setSpeichert(false);
    if (r.error) return toast({ variant: "destructive", title: "Kunde nicht angelegt", description: r.error });
    const k = { ...row, id, kundennr: null, liefer_ort: row.liefer_ort ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: user?.id ?? null } as Kunde;
    setExtra(k);
    setzeSpeicher([...(zwischenspeicher ?? []), k]);
    toast({ title: r.queued ? "Kunde offline gespeichert" : "Kunde angelegt", description: `${kundeName(k)} ist ausgewählt.` });
    setNeu(null);
    waehlen(k);
    if (!r.queued) ladeKunden(true);
  };

  // ---- Neuer Kunde (direkt hier, kein zweites Fenster) ----
  if (neu) {
    return (
      <div className={cn("rounded-lg border-2 border-primary/40 p-3 space-y-3", className)}>
        <p className="font-medium flex items-center gap-2"><UserPlus className="h-4 w-4" /> Neuer Kunde</p>
        <CustomerFormFields form={neu} setForm={setNeu} zeigeRechnungsdaten={zeigeRechnungsdaten} />
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => setNeu(null)} disabled={speichert}>Abbrechen</Button>
          <Button type="button" className="flex-1 gap-1.5" onClick={neuSpeichern} disabled={speichert}>
            {speichert && <Loader2 className="h-4 w-4 animate-spin" />} Kunde speichern
          </Button>
        </div>
      </div>
    );
  }

  // ---- Gewählter Kunde: Karte mit Adresse ----
  if (gewaehlt && !offen) {
    const a = kundeAdresse(gewaehlt);
    return (
      <div className={cn("rounded-lg border bg-muted/30 p-3 flex items-start gap-3", className)} data-testid="kunde-gewaehlt">
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{kundeName(gewaehlt)}{gewaehlt.kundennr ? <span className="text-muted-foreground font-normal text-sm"> · Nr. {gewaehlt.kundennr}</span> : null}</p>
          {gewaehlt.firma?.trim() && (gewaehlt.vorname || gewaehlt.nachname) && (
            <p className="text-sm text-muted-foreground break-words">{[gewaehlt.vorname, gewaehlt.nachname].filter(Boolean).join(" ")}</p>
          )}
          {(a.strasse || gewaehlt.ort) && (
            <p className="text-sm text-muted-foreground break-words flex items-start gap-1"><MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />{[a.strasse, gewaehlt.ort].filter(Boolean).join(", ")}</p>
          )}
          {(gewaehlt.telefon || gewaehlt.mobil) && (
            <p className="text-sm text-muted-foreground flex items-center gap-1"><Phone className="h-3.5 w-3.5 shrink-0" />{gewaehlt.mobil || gewaehlt.telefon}</p>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <Button type="button" size="sm" variant="outline" onClick={() => { setOffen(true); setTimeout(() => eingabe.current?.focus(), 0); }}>Ändern</Button>
          {!pflicht && (
            <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => waehlen(null)} aria-label="Kunde entfernen">
              <X className="h-4 w-4" /> Kein Kunde
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ---- Suchen ----
  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={eingabe}
          className="pl-9 h-11"
          placeholder="Kunde suchen: Name, Firma, Ort, Telefon …"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          aria-label="Kunde suchen"
          autoComplete="off"
        />
      </div>
      {suche.trim() && (
        <div className="rounded-md border max-h-64 overflow-y-auto divide-y bg-background" role="listbox" aria-label="Gefundene Kunden">
          {treffer.map((k) => (
            <button
              key={k.id}
              type="button"
              role="option"
              aria-selected={k.id === wert}
              className="w-full text-left px-3 py-2 hover:bg-accent focus:bg-accent focus:outline-none"
              onClick={() => waehlen(k)}
            >
              <span className="block font-medium break-words">{kundeName(k)}{k.kundennr ? <span className="text-muted-foreground font-normal text-xs"> · Nr. {k.kundennr}</span> : null}</span>
              <span className="block text-xs text-muted-foreground break-words">{[k.strasse, k.ort].filter(Boolean).join(", ") || "ohne Adresse"}</span>
            </button>
          ))}
          {treffer.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {kunden.length === 0 ? "Kunden werden geladen …" : "Kein Kunde gefunden."}
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1 gap-2" onClick={neuStarten}>
          <UserPlus className="h-4 w-4" />
          {suche.trim() ? `„${suche.trim()}“ neu anlegen` : "Neuen Kunden anlegen"}
        </Button>
        {offen && gewaehlt && (
          <Button type="button" variant="ghost" onClick={() => { setOffen(false); setSuche(""); }}>Abbrechen</Button>
        )}
      </div>
    </div>
  );
}
