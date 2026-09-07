import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Share2, FileSpreadsheet, FileArchive, Calendar } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import JSZip from "jszip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  TYP_LABEL, TYP_DATEINAME, STATUS_LABEL, datum, zahl, istRechnung, istAngebot, offen, belegPdf,
  type Beleg, type BelegPosition,
} from "@/lib/faktura";

type Gruppe = "angebote" | "rechnungen" | "gutschriften";
const GRUPPEN: { key: Gruppe; label: string; hinweis: string; passt: (b: Beleg) => boolean }[] = [
  { key: "angebote", label: "Angebote", hinweis: "auch Auftragsbestätigungen", passt: (b) => istAngebot(b.typ) },
  { key: "rechnungen", label: "Rechnungen", hinweis: "auch Teil- und Schlussrechnungen", passt: (b) => istRechnung(b.typ) },
  { key: "gutschriften", label: "Gutschriften", hinweis: "Stornos", passt: (b) => b.typ === "gutschrift" },
];

const MONATE = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const monatsName = (ym: string) => `${MONATE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
// Dateiname ohne Zeichen, die Windows/macOS nicht mögen
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 90);
const zahlenwert = (n: number | string | null | undefined) => Math.round(Number(n ?? 0) * 100) / 100;
// Gutschriften stehen in der Buchhaltung mit Minus — so ergibt die Summe den echten Erlös
const vz = (b: Beleg) => (b.typ === "gutschrift" ? -1 : 1);
// Echtes Excel-Datum (sortier- und filterbar) statt Text
const xlDatum = (iso: string | null | undefined) => (iso ? { v: new Date(`${iso}T00:00:00`), t: "d" as const, z: "DD.MM.YYYY" } : "");
const ios = typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/**
 * Monatsexport für Angebote, Rechnungen und Gutschriften.
 *
 * Auswahl: Zeitraum (Monat, Jahr, alles oder frei), Belegarten, Entwürfe ja/nein
 * und was herauskommen soll — eine Excel-Liste, die Positionen einzeln und/oder
 * alle PDFs gebündelt. Am iPhone kommt statt „Herunterladen“ das Teilen-Blatt,
 * weil die installierte App keine Datei-Downloads kennt.
 */
export function BelegExport({ open, onOpenChange, belege, hinweis }: { open: boolean; onOpenChange: (o: boolean) => void; belege: Beleg[]; hinweis?: string }) {
  const { toast } = useToast();
  const heute = new Date();
  const aktuellerMonat = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}`;

  const [zeitraum, setZeitraum] = useState<"monat" | "jahr" | "alles" | "frei">("monat");
  const [monat, setMonat] = useState(aktuellerMonat);
  const [jahr, setJahr] = useState(String(heute.getFullYear()));
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [gruppen, setGruppen] = useState<Record<Gruppe, boolean>>({ angebote: true, rechnungen: true, gutschriften: true });
  const [mitEntwuerfen, setMitEntwuerfen] = useState(false);
  const [wasListe, setWasListe] = useState(true);
  const [wasPositionen, setWasPositionen] = useState(true);
  const [wasPdfs, setWasPdfs] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState({ fertig: 0, gesamt: 0, text: "" });
  const [ergebnis, setErgebnis] = useState<{ blob: Blob; name: string } | null>(null);
  const abbruch = useRef(false);

  useEffect(() => { if (open) setErgebnis(null); }, [open]);
  // Änderung der Auswahl → altes Ergebnis passt nicht mehr
  useEffect(() => { setErgebnis(null); }, [zeitraum, monat, jahr, von, bis, gruppen, mitEntwuerfen, wasListe, wasPositionen, wasPdfs]);

  // Monate und Jahre, in denen es überhaupt Belege gibt
  const monate = useMemo(() => {
    const s = new Set(belege.map((b) => b.datum.slice(0, 7)));
    s.add(aktuellerMonat);
    return [...s].sort().reverse();
  }, [belege, aktuellerMonat]);
  const jahre = useMemo(() => {
    const s = new Set(belege.map((b) => b.datum.slice(0, 4)));
    s.add(String(heute.getFullYear()));
    return [...s].sort().reverse();
  }, [belege, heute]);

  const imZeitraum = (b: Beleg) => {
    if (!mitEntwuerfen && b.status === "entwurf") return false;
    if (zeitraum === "monat") return b.datum.slice(0, 7) === monat;
    if (zeitraum === "jahr") return b.datum.slice(0, 4) === jahr;
    if (zeitraum === "frei") return (!von || b.datum >= von) && (!bis || b.datum <= bis);
    return true;
  };
  const gewaehlt = useMemo(() => {
    return belege
      .filter((b) => imZeitraum(b) && GRUPPEN.some((g) => gruppen[g.key] && g.passt(b)))
      .sort((a, c) => (a.datum === c.datum ? (a.nummer ?? "").localeCompare(c.nummer ?? "") : a.datum.localeCompare(c.datum)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [belege, gruppen, mitEntwuerfen, zeitraum, monat, jahr, von, bis]);

  const summen = useMemo(() => {
    const re = gewaehlt.filter((b) => (istRechnung(b.typ) || b.typ === "gutschrift") && b.status !== "entwurf");
    return {
      netto: re.reduce((s, b) => s + vz(b) * Number(b.netto), 0),
      brutto: re.reduce((s, b) => s + vz(b) * Number(b.brutto), 0),
      offen: re.reduce((s, b) => s + offen(b), 0),
      mitPdf: gewaehlt.filter((b) => b.status !== "entwurf").length,
    };
  }, [gewaehlt]);

  const zeitraumName = zeitraum === "monat" ? monatsName(monat)
    : zeitraum === "jahr" ? jahr
    : zeitraum === "frei" ? `${von || "Anfang"} bis ${bis || "heute"}`
    : "alle Belege";

  const bauen = async () => {
    if (gewaehlt.length === 0 || laeuft) return;
    if (!wasListe && !wasPositionen && !wasPdfs) {
      return toast({ variant: "destructive", title: "Nichts ausgewählt", description: "Bitte mindestens eine Sache zum Exportieren ankreuzen." });
    }
    setLaeuft(true);
    setErgebnis(null);
    abbruch.current = false;
    try {
      const dateien: { name: string; daten: ArrayBuffer | Blob }[] = [];

      // ── Excel: Belegliste (und optional die Positionen) ────────────────
      if (wasListe || wasPositionen) {
        setFortschritt({ fertig: 0, gesamt: 1, text: "Liste wird erstellt…" });
        const wb = XLSX.utils.book_new();
        if (wasListe) {
          // „Bezahlt“ enthält auch Skonto-Abzüge — die Buchhaltung braucht sie getrennt (Erlösschmälerung)
          const skonto = new Map<string, number>();
          const ids = gewaehlt.map((b) => b.id);
          for (let i = 0; i < ids.length; i += 50) {
            if (abbruch.current) throw new Error("abgebrochen");
            for (let von = 0; ; von += 1000) {
              const { data, error } = await supabase.from("beleg_zahlungen").select("beleg_id, betrag").eq("art", "skonto").in("beleg_id", ids.slice(i, i + 50)).order("beleg_id").order("id").range(von, von + 999);
              if (error) throw new Error(`Zahlungen konnten nicht geladen werden: ${error.message}`);
              for (const z of data ?? []) skonto.set(z.beleg_id, (skonto.get(z.beleg_id) ?? 0) + Number(z.betrag));
              if (!data || data.length < 1000) break;
            }
          }
          const kopf = ["Belegart", "Nummer", "Datum", "Kunde", "UID Kunde", "Betreff", "Leistung von", "Leistung bis",
            "Zahlbar bis", "Netto", "USt-Satz %", "USt", "Brutto", "Bezahlt", "davon Skonto", "Offen", "Status", "Reverse Charge"];
          const zeilen = gewaehlt.map((b) => [
            TYP_LABEL[b.typ], b.nummer ?? "(Entwurf)", xlDatum(b.datum), b.kunde_name, b.kunde_uid ?? "", b.betreff ?? "",
            xlDatum(b.leistung_von), xlDatum(b.leistung_bis), xlDatum(b.faellig_am),
            zahlenwert(vz(b) * Number(b.netto)), b.reverse_charge ? 0 : Number(b.ust_satz), zahlenwert(vz(b) * Number(b.ust)), zahlenwert(vz(b) * Number(b.brutto)),
            zahlenwert(b.bezahlt), zahlenwert(skonto.get(b.id) ?? 0), zahlenwert(offen(b)), STATUS_LABEL[b.status], b.reverse_charge ? "ja" : "nein",
          ]);
          // Summe: Rechnungen abzüglich Gutschriften — Angebote (kein Umsatz) und Entwürfe (keine Nummer) zählen nicht
          const re = gewaehlt.filter((b) => (istRechnung(b.typ) || b.typ === "gutschrift") && b.status !== "entwurf");
          const summe = ["Summe Rechnungen abzüglich Gutschriften", "", "", "", "", "", "", "", "",
            zahlenwert(re.reduce((s, b) => s + vz(b) * Number(b.netto), 0)), "", zahlenwert(re.reduce((s, b) => s + vz(b) * Number(b.ust), 0)),
            zahlenwert(re.reduce((s, b) => s + vz(b) * Number(b.brutto), 0)), zahlenwert(re.reduce((s, b) => s + Number(b.bezahlt), 0)),
            zahlenwert(re.reduce((s, b) => s + (skonto.get(b.id) ?? 0), 0)), zahlenwert(re.reduce((s, b) => s + offen(b), 0)), "", ""];
          const ws = XLSX.utils.aoa_to_sheet([kopf, ...zeilen, [], summe], { cellDates: true });
          ws["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 11 }, { wch: 28 }, { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 12 },
            { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 16 }, { wch: 14 }];
          const bereich = XLSX.utils.decode_range(ws["!ref"] || "A1");
          for (let c = bereich.s.c; c <= bereich.e.c; c++) {
            const zelle = ws[XLSX.utils.encode_cell({ r: 0, c })];
            if (zelle) zelle.s = { font: { bold: true }, fill: { fgColor: { rgb: "EEEEEE" } } };
            const sz = ws[XLSX.utils.encode_cell({ r: zeilen.length + 2, c })];
            if (sz) sz.s = { font: { bold: true } };
          }
          XLSX.utils.book_append_sheet(wb, ws, "Belege");
        }
        if (wasPositionen) {
          const ids = gewaehlt.map((b) => b.id);
          const pos: BelegPosition[] = [];
          // In Blöcken je 50 Belege, jeder Block seitenweise (PostgREST liefert höchstens 1000 Zeilen je Anfrage)
          for (let i = 0; i < ids.length; i += 50) {
            if (abbruch.current) throw new Error("abgebrochen");
            let von = 0;
            for (;;) {
              const { data, error } = await supabase.from("beleg_positionen").select("*").in("beleg_id", ids.slice(i, i + 50)).order("beleg_id").order("pos").range(von, von + 999);
              if (error) throw new Error(`Positionen konnten nicht geladen werden: ${error.message}`);
              pos.push(...((data ?? []) as BelegPosition[]));
              if (!data || data.length < 1000) break;
              von += 1000;
            }
          }
          const nach = new Map(gewaehlt.map((b) => [b.id, b]));
          const reihenfolge = new Map(gewaehlt.map((b, i) => [b.id, i]));
          const kopf = ["Belegart", "Nummer", "Datum", "Kunde", "Pos", "Bezeichnung", "Beschreibung", "Menge", "Einheit", "Einzelpreis", "Rabatt %", "Betrag"];
          const zeilen = pos
            .filter((p) => nach.has(p.beleg_id))
            // Beleg für Beleg in der Reihenfolge der Liste, darin nach Positionsnummer
            .sort((a, c) => (reihenfolge.get(a.beleg_id)! - reihenfolge.get(c.beleg_id)!) || (a.pos - c.pos) || a.created_at.localeCompare(c.created_at))
            .map((p) => {
              const b = nach.get(p.beleg_id)!;
              return [TYP_LABEL[b.typ], b.nummer ?? "(Entwurf)", xlDatum(b.datum), b.kunde_name, p.pos,
                p.text, p.beschreibung ?? "", p.art === "position" ? Number(p.menge) : "", p.einheit ?? "",
                p.art === "position" ? zahlenwert(p.einzelpreis) : "", p.art === "position" ? Number(p.rabatt_prozent ?? 0) : "",
                p.art === "position" ? zahlenwert(vz(b) * Number(p.gesamt)) : ""];
            });
          const ws = XLSX.utils.aoa_to_sheet([kopf, ...zeilen], { cellDates: true });
          ws["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 11 }, { wch: 26 }, { wch: 5 }, { wch: 40 }, { wch: 40 }, { wch: 9 }, { wch: 8 }, { wch: 12 }, { wch: 9 }, { wch: 12 }];
          const bereich = XLSX.utils.decode_range(ws["!ref"] || "A1");
          for (let c = bereich.s.c; c <= bereich.e.c; c++) {
            const zelle = ws[XLSX.utils.encode_cell({ r: 0, c })];
            if (zelle) zelle.s = { font: { bold: true }, fill: { fgColor: { rgb: "EEEEEE" } } };
          }
          XLSX.utils.book_append_sheet(wb, ws, "Positionen");
        }
        const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
        dateien.push({ name: `Belege ${safe(zeitraumName)}.xlsx`, daten: bytes });
      }

      // ── PDFs ───────────────────────────────────────────────────────────
      const pdfs: { name: string; daten: Blob }[] = [];
      if (wasPdfs) {
        const mitNummer = gewaehlt.filter((b) => b.status !== "entwurf");
        setFortschritt({ fertig: 0, gesamt: mitNummer.length, text: "PDFs werden geholt…" });
        let fehlend = 0;
        for (let i = 0; i < mitNummer.length; i++) {
          if (abbruch.current) throw new Error("abgebrochen");
          const b = mitNummer[i];
          let blob: Blob | null = null;
          try {
            if (b.pdf_pfad) {
              // Abgelegtes PDF holen — das Archiv wird dabei nie neu erzeugt oder überschrieben
              const { data } = await supabase.storage.from("project-files").download(b.pdf_pfad);
              blob = data ?? null;
            } else {
              // Noch kein PDF abgelegt (älterer Beleg) → einmal erzeugen lassen
              const r = await belegPdf(b.id);
              if (r.base64) blob = new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], { type: "application/pdf" });
              else if (r.url) { const res = await fetch(r.url); if (res.ok) blob = await res.blob(); }
            }
          } catch { blob = null; }
          if (blob) pdfs.push({ name: `${safe(`${TYP_DATEINAME[b.typ]} ${b.nummer ?? ""} ${b.kunde_name}`)}.pdf`, daten: blob });
          else fehlend++;
          setFortschritt({ fertig: i + 1, gesamt: mitNummer.length, text: `PDF ${i + 1} von ${mitNummer.length}` });
        }
        if (fehlend > 0) toast({ title: "Einzelne PDFs fehlen", description: `${fehlend} Beleg(e) konnten nicht geholt werden — die Liste ist trotzdem vollständig.` });
      }

      // ── Zusammenpacken ─────────────────────────────────────────────────
      const basis = `Belege ${safe(zeitraumName)}`;
      if (pdfs.length > 0 || dateien.length > 1) {
        setFortschritt({ fertig: 0, gesamt: 1, text: "Wird gepackt…" });
        const zip = new JSZip();
        dateien.forEach((d) => zip.file(d.name, d.daten));
        const ordner = pdfs.length ? zip.folder("PDF") : null;
        pdfs.forEach((p, i) => ordner?.file(`${String(i + 1).padStart(3, "0")} ${p.name}`, p.daten));
        const blob = await zip.generateAsync({ type: "blob" });
        setErgebnis({ blob, name: `${basis}.zip` });
      } else if (dateien.length === 1) {
        setErgebnis({ blob: new Blob([dateien[0].daten as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name: dateien[0].name });
      } else {
        toast({ variant: "destructive", title: "Nichts zum Speichern", description: "Es konnte keine einzige Datei erzeugt werden." });
        return;
      }
      toast({ title: "Export fertig", description: `${gewaehlt.length} Belege${pdfs.length ? ` und ${pdfs.length} PDFs` : ""} — jetzt ${ios ? "teilen" : "herunterladen"}.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "abgebrochen") toast({ title: "Export abgebrochen" });
      else toast({ variant: "destructive", title: "Export fehlgeschlagen", description: msg });
    } finally {
      setLaeuft(false);
      setFortschritt({ fertig: 0, gesamt: 0, text: "" });
    }
  };

  const herunterladen = () => {
    if (!ergebnis) return;
    const url = URL.createObjectURL(ergebnis.blob);
    const a = document.createElement("a");
    a.href = url; a.download = ergebnis.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const teilen = async () => {
    if (!ergebnis) return;
    try {
      const datei = new File([ergebnis.blob], ergebnis.name, { type: ergebnis.blob.type || "application/octet-stream" });
      if (navigator.canShare?.({ files: [datei] })) await navigator.share({ files: [datei], title: ergebnis.name });
      else herunterladen();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast({ variant: "destructive", title: "Teilen nicht möglich", description: "Die Datei wird stattdessen heruntergeladen." });
      if (!(e instanceof DOMException && e.name === "AbortError")) herunterladen();
    }
  };
  const kannTeilen = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!laeuft) onOpenChange(o); }}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Belege exportieren</DialogTitle>
          <DialogDescription>Für die Buchhaltung: Liste als Excel-Datei, dazu auf Wunsch alle PDFs in einem Paket.</DialogDescription>
        </DialogHeader>
        {hinweis && <p className="text-xs text-amber-700 dark:text-amber-400 -mt-2">{hinweis}</p>}

        <div className="space-y-4">
          {/* Zeitraum */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2"><Calendar className="h-4 w-4" />Zeitraum</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {([["monat", "Monat"], ["jahr", "Jahr"], ["alles", "Alles"], ["frei", "Von–bis"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setZeitraum(k)}
                  className={cn("rounded-md border px-2 py-2 text-sm transition-colors", zeitraum === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent/50")}>
                  {l}
                </button>
              ))}
            </div>
            {zeitraum === "monat" && (
              <Select value={monat} onValueChange={setMonat}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">{monate.map((m) => <SelectItem key={m} value={m}>{monatsName(m)}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {zeitraum === "jahr" && (
              <Select value={jahr} onValueChange={setJahr}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{jahre.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {zeitraum === "frei" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">von</Label><Input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">bis</Label><Input type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></div>
              </div>
            )}
          </div>

          {/* Belegarten */}
          <div className="space-y-1.5">
            <Label>Was soll dabei sein?</Label>
            <div className="space-y-1">
              {GRUPPEN.map((g) => {
                const n = belege.filter((b) => g.passt(b) && imZeitraum(b)).length;
                return (
                  <label key={g.key} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                    <Checkbox checked={gruppen[g.key]} onCheckedChange={(v) => setGruppen({ ...gruppen, [g.key]: !!v })} />
                    <span className="flex-1 min-w-0 text-sm">{g.label} <span className="text-muted-foreground">· {g.hinweis}</span></span>
                    <span className="text-xs text-muted-foreground tabular-nums">{n}</span>
                  </label>
                );
              })}
              <label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                <Checkbox checked={mitEntwuerfen} onCheckedChange={(v) => setMitEntwuerfen(!!v)} />
                <span className="flex-1 min-w-0 text-sm">Entwürfe mitnehmen <span className="text-muted-foreground">· noch ohne Nummer</span></span>
              </label>
            </div>
          </div>

          {/* Dateien */}
          <div className="space-y-1.5">
            <Label>Welche Dateien?</Label>
            <div className="space-y-1">
              <label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                <Checkbox checked={wasListe} onCheckedChange={(v) => setWasListe(!!v)} />
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 text-sm">Liste als Excel-Datei <span className="text-muted-foreground">· eine Zeile je Beleg</span></span>
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                <Checkbox checked={wasPositionen} onCheckedChange={(v) => setWasPositionen(!!v)} />
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 text-sm">Positionen einzeln <span className="text-muted-foreground">· zweites Blatt in der Excel-Datei</span></span>
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                <Checkbox checked={wasPdfs} onCheckedChange={(v) => setWasPdfs(!!v)} />
                <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 text-sm">Alle PDFs <span className="text-muted-foreground">· als Paket, dauert etwas länger</span></span>
              </label>
            </div>
          </div>

          {/* Vorschau */}
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <div className="font-medium">{gewaehlt.length} {gewaehlt.length === 1 ? "Beleg" : "Belege"} · {zeitraumName}</div>
            {gewaehlt.length > 0 && (
              <div className="text-muted-foreground tabular-nums">
                Rechnungen abzüglich Gutschriften: netto {zahl(summen.netto)} € · brutto {zahl(summen.brutto)} €{summen.offen > 0 ? ` · offen ${zahl(summen.offen)} €` : ""}
                {wasPdfs ? ` · ${summen.mitPdf} PDFs` : ""}
              </div>
            )}
            {gewaehlt.length === 0 && <div className="text-muted-foreground">In diesem Zeitraum gibt es nichts zum Exportieren.</div>}
          </div>

          {laeuft && (
            <div className="space-y-2">
              <Progress value={fortschritt.gesamt ? (fortschritt.fertig / fortschritt.gesamt) * 100 : 10} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{fortschritt.text}</p>
                <Button variant="ghost" size="sm" onClick={() => { abbruch.current = true; }}>Abbrechen</Button>
              </div>
            </div>
          )}

          {ergebnis ? (
            <div className="space-y-2">
              <div className="rounded-md border border-green-300 bg-green-50 dark:bg-green-950/30 p-3 text-sm">
                Fertig: <span className="font-medium">{ergebnis.name}</span> ({Math.max(1, Math.round(ergebnis.blob.size / 1024))} kB)
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                {kannTeilen && <Button onClick={teilen} variant={ios ? "default" : "outline"} className="gap-2 flex-1"><Share2 className="h-4 w-4" />Teilen</Button>}
                <Button onClick={herunterladen} variant={ios && kannTeilen ? "outline" : "default"} className="gap-2 flex-1"><Download className="h-4 w-4" />Herunterladen</Button>
              </div>
              {ios && <p className="text-xs text-muted-foreground">Am iPhone/iPad über „Teilen“ in Dateien, Mail oder an den Steuerberater weitergeben.</p>}
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={laeuft}>Abbrechen</Button>
              <Button onClick={bauen} disabled={laeuft || gewaehlt.length === 0} className="gap-2">
                {laeuft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Export erstellen
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BelegExport;
