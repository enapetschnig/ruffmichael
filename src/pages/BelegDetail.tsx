import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2, Lock, FileDown, Clock, ArrowRight, Ban, Euro, ChevronUp, ChevronDown, Loader2, Pencil, Receipt } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { BelegVorschau } from "@/components/BelegVorschau";
import {
  TYP_LABEL, TYP_DATEINAME, STATUS_LABEL, STATUS_VARIANT, EINHEITEN, eur, zahl, datum, heuteISO, plusTage, parseZahl,
  istRechnung, istAngebot, offen, belegTitel, belegPdf, ladeFirmendaten,
  type Beleg, type BelegPosition, type Zahlung,
} from "@/lib/faktura";

type OffeneStunden = Database["public"]["Functions"]["faktura_offene_stunden"]["Returns"][number];
type Nachfolger = { id: string; typ: Beleg["typ"]; nummer: string | null; status: Beleg["status"] };

/**
 * Ein Beleg: Kopf, Positionen, Summen, Zahlungen und alle Aktionen (nur Admin).
 *
 * Bedienregeln, die hier bewusst gelten:
 *  - Textfelder speichern beim Verlassen (onBlur), nicht bei jedem Tastendruck.
 *  - Zahlenfelder sind Textfelder mit Komma-Unterstützung („12,5“) — type=number
 *    macht am iPhone aus einem Komma still eine 0.
 *  - Nach jedem Speichern werden nur die Summen nachgeladen, nie die ganze
 *    Positionsliste — sonst würde ein gerade bearbeitetes Nachbarfeld
 *    überschrieben.
 *  - Festschreiben wartet, bis alle laufenden Speichervorgänge durch sind.
 */
const BelegDetail = () => {
  const { belegId } = useParams<{ belegId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [b, setB] = useState<Beleg | null>(null);
  const [pos, setPos] = useState<BelegPosition[]>([]);
  const [zahlungen, setZahlungen] = useState<Zahlung[]>([]);
  const [nachfolger, setNachfolger] = useState<Nachfolger[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [vorschau, setVorschau] = useState<{ open: boolean; url: string | null; blob: Blob | null; entwurf: boolean }>({ open: false, url: null, blob: null, entwurf: true });
  const vorschauToken = useRef(0);
  const [stundenOpen, setStundenOpen] = useState(false);
  const [stunden, setStunden] = useState<(OffeneStunden & { gewaehlt: boolean; satzWert: string })[]>([]);
  const [zahlungOpen, setZahlungOpen] = useState(false);
  const [zahlung, setZahlung] = useState({ betrag: "", datum: heuteISO(), art: "ueberweisung", notiz: "" });
  const [frage, setFrage] = useState<"festschreiben" | "storno" | "loeschen" | null>(null);
  const [zahlungLoeschenId, setZahlungLoeschenId] = useState<string | null>(null);
  // Zahlenfelder: was gerade getippt wird (bis zum Verlassen des Felds)
  const [tipp, setTipp] = useState<Record<string, string>>({});
  // laufende Speichervorgänge — Festschreiben wartet darauf
  const pending = useRef(0);

  const entwurf = b?.status === "entwurf";
  const rechnung = b ? istRechnung(b.typ) : false;

  const laden = async () => {
    if (!belegId) return;
    const [{ data: beleg, error: belegFehler }, { data: p }, { data: z }, { data: nf }] = await Promise.all([
      supabase.from("belege").select("*").eq("id", belegId).maybeSingle(),
      supabase.from("beleg_positionen").select("*").eq("beleg_id", belegId).order("pos").order("created_at"),
      supabase.from("beleg_zahlungen").select("*").eq("beleg_id", belegId).order("datum"),
      supabase.from("belege").select("id, typ, nummer, status").eq("vorgaenger_id", belegId).order("created_at"),
    ]);
    // Verbindungsfehler ≠ „nicht gefunden“: ohne Netz ehrlich sagen, was los ist
    if (belegFehler) { toast({ title: "Keine Verbindung", description: "Der Beleg konnte nicht geladen werden — bitte Internet prüfen." }); return navigate("/"); }
    if (!beleg) { toast({ variant: "destructive", title: "Beleg nicht gefunden" }); return navigate("/belege"); }
    setB(beleg); setPos(p ?? []); setZahlungen(z ?? []); setNachfolger((nf as Nachfolger[]) ?? []);
  };
  useEffect(() => { laden(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [belegId]);

  // ── Kopf speichern (nur Entwurf; die DB lehnt alles andere ab) ───────────
  const kopf = async (patch: Partial<Beleg>) => {
    if (!b) return;
    setB((x) => (x ? { ...x, ...patch } : x));
    pending.current++;
    try {
      const { error } = await supabase.from("belege").update(patch).eq("id", b.id);
      if (error) toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
      else if ("reverse_charge" in patch || "ust_satz" in patch) summenNeu();
    } finally { pending.current--; }
  };
  const kopfLokal = (patch: Partial<Beleg>) => setB((x) => (x ? { ...x, ...patch } : x));

  // ── Positionen ─────────────────────────────────────────────────────────
  // Nur Summen + Zeilenbeträge nachladen — nie die Felder der Positionen überschreiben.
  const summenNeu = async () => {
    if (!b) return;
    const [{ data }, { data: p }] = await Promise.all([
      supabase.from("belege").select("netto, ust, brutto").eq("id", b.id).single(),
      supabase.from("beleg_positionen").select("id, gesamt").eq("beleg_id", b.id),
    ]);
    if (data) setB((x) => (x ? { ...x, ...data } : x));
    if (p) setPos((l) => l.map((x) => ({ ...x, gesamt: p.find((y) => y.id === x.id)?.gesamt ?? x.gesamt })));
  };
  // Vollständig neu laden — nur bei Einfügen, Löschen, Verschieben.
  const posLaden = async () => {
    if (!b) return;
    const { data: p } = await supabase.from("beleg_positionen").select("*").eq("beleg_id", b.id).order("pos").order("created_at");
    if (p) setPos(p);
    await summenNeu();
  };
  const posSpeichern = async (id: string, patch: Partial<BelegPosition>) => {
    setPos((l) => l.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    pending.current++;
    try {
      const { error } = await supabase.from("beleg_positionen").update(patch).eq("id", id);
      if (error) toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
      else await summenNeu();
    } finally { pending.current--; }
  };
  const posNeu = async (art: "position" | "ueberschrift" | "text" = "position") => {
    if (!b || busy) return;
    setBusy("pos");
    // pos = null → die Datenbank vergibt die nächste Nummer (kein Doppeltipp-Problem)
    const { error } = await supabase.from("beleg_positionen").insert({ beleg_id: b.id, pos: null, art, text: art === "position" ? "" : art === "ueberschrift" ? "Überschrift" : "Hinweis", menge: 1, einheit: art === "position" ? "Stk" : "", einzelpreis: 0 });
    if (error) toast({ variant: "destructive", title: "Fehler", description: error.message });
    await posLaden();
    setBusy(null);
  };
  const posLoeschen = async (id: string) => {
    const p = pos.find((x) => x.id === id);
    const { error } = await supabase.from("beleg_positionen").delete().eq("id", id);
    if (error) return toast({ variant: "destructive", title: "Nicht gelöscht", description: error.message });
    // Stunden dieser Position wieder freigeben (nur wenn das Löschen geklappt hat)
    if (p?.quelle_typ === "stunden" && p.quelle_ids.length) {
      const { error: e2 } = await supabase.rpc("faktura_stunden_markieren", { p_beleg: null, p_ids: p.quelle_ids });
      if (e2) toast({ variant: "destructive", title: "Stunden nicht freigegeben", description: e2.message });
    }
    posLaden();
  };
  const posVerschieben = async (id: string, richtung: -1 | 1) => {
    const sortiert = [...pos].sort((a, c) => a.pos - c.pos || a.created_at.localeCompare(c.created_at));
    const i = sortiert.findIndex((p) => p.id === id);
    const j = i + richtung;
    if (i < 0 || j < 0 || j >= sortiert.length) return;
    const a = sortiert[i], c = sortiert[j];
    // Abzugszeilen (≥ 900) bleiben unten — nicht mit normalen Positionen tauschen
    if ((a.pos >= 900) !== (c.pos >= 900)) return;
    // gleiche pos (Altbestand) → eindeutige Reihenfolge herstellen
    const posA = a.pos === c.pos ? c.pos + (richtung > 0 ? 1 : -1) : c.pos;
    await Promise.all([
      supabase.from("beleg_positionen").update({ pos: posA }).eq("id", a.id),
      supabase.from("beleg_positionen").update({ pos: a.pos }).eq("id", c.id),
    ]);
    posLaden();
  };

  // Zahlenfeld: Tippen lokal, speichern beim Verlassen; Komma erlaubt
  const zahlFeld = (p: BelegPosition, feld: "menge" | "einzelpreis" | "rabatt_prozent", label: string, min?: number, max?: number) => {
    const key = `${p.id}.${feld}`;
    const gesperrt = !entwurf || p.quelle_typ === "teilrechnung";
    return (
      <div className="space-y-1">
        <Label className="text-[11px]">{label}</Label>
        <Input
          type="text" inputMode="decimal" className="text-right"
          value={tipp[key] ?? zahl(p[feld])}
          disabled={gesperrt}
          onChange={(e) => setTipp((t) => ({ ...t, [key]: e.target.value }))}
          onBlur={(e) => {
            const n = parseZahl(e.target.value);
            setTipp((t) => { const { [key]: _, ...r } = t; return r; });
            if (n === null || (min !== undefined && n < min) || (max !== undefined && n > max)) {
              return toast({ variant: "destructive", title: "Keine gültige Zahl", description: `„${e.target.value}“ — bitte z. B. 12,5 eingeben${max !== undefined ? ` (0–${max})` : ""}.` });
            }
            if (n !== Number(p[feld])) posSpeichern(p.id, { [feld]: n } as Partial<BelegPosition>);
          }}
        />
      </div>
    );
  };

  // ── Stunden holen ──────────────────────────────────────────────────────
  const stundenLaden = async () => {
    if (!b?.project_id) return toast({ variant: "destructive", title: "Kein Projekt", description: "Stunden holen geht nur bei Belegen mit Projekt." });
    const { data, error } = await supabase.rpc("faktura_offene_stunden", { p_projekt: b.project_id });
    if (error) return toast({ variant: "destructive", title: "Fehler", description: error.message });
    setStunden((data ?? []).map((r) => ({ ...r, gewaehlt: true, satzWert: r.satz != null ? String(r.satz).replace(".", ",") : "" })));
    setStundenOpen(true);
  };
  const stundenUebernehmen = async () => {
    if (!b || busy) return;
    const gew = stunden.filter((s) => s.gewaehlt);
    if (gew.some((s) => (parseZahl(s.satzWert) ?? 0) <= 0)) {
      return toast({ variant: "destructive", title: "Stundensatz fehlt", description: "Für jede gewählte Zeile einen Satz > 0 angeben (Einstellungen → Stundensätze)." });
    }
    setBusy("stunden");
    let von = b.leistung_von, bis = b.leistung_bis;
    for (const s of gew) {
      const satz = parseZahl(s.satzWert)!;
      // Zuerst markieren (die DB lehnt bereits verrechnete Stunden ab), dann die Position
      const { error: em } = await supabase.rpc("faktura_stunden_markieren", { p_beleg: b.id, p_ids: s.entry_ids });
      if (em) { toast({ variant: "destructive", title: "Stunden nicht übernommen", description: em.message }); break; }
      const { error } = await supabase.from("beleg_positionen").insert({
        beleg_id: b.id, pos: null, art: "position",
        text: `Monteurstunden${s.gruppe ? ` ${s.gruppe}` : ""} – ${s.mitarbeiter}`,
        beschreibung: `${datum(s.von)}${s.von !== s.bis ? ` – ${datum(s.bis)}` : ""}, ${s.bloecke} Einsätze`,
        menge: Number(s.stunden), einheit: "h", einzelpreis: satz, quelle_typ: "stunden", quelle_ids: s.entry_ids,
      });
      if (error) {
        await supabase.rpc("faktura_stunden_markieren", { p_beleg: null, p_ids: s.entry_ids });
        toast({ variant: "destructive", title: "Fehler", description: error.message }); break;
      }
      if (!von || s.von < von) von = s.von;
      if (!bis || s.bis > bis) bis = s.bis;
    }
    // Leistungszeitraum um die Stunden erweitern
    if ((von !== b.leistung_von) || (bis !== b.leistung_bis)) await kopf({ leistung_von: von, leistung_bis: bis });
    setStundenOpen(false); await posLaden(); setBusy(null);
  };

  // ── Aktionen ───────────────────────────────────────────────────────────
  const wartenBisGespeichert = async () => {
    let n = 0;
    while (pending.current > 0 && n++ < 50) await new Promise((r) => setTimeout(r, 100));
  };
  const festschreiben = async () => {
    if (!b) return;
    setBusy("fest");
    await wartenBisGespeichert();
    const { error } = await supabase.rpc("beleg_festschreiben", { p_beleg: b.id });
    if (error) { setBusy(null); return toast({ variant: "destructive", title: "Nicht festgeschrieben", description: error.message }); }
    await laden();
    // PDF gleich erzeugen und in OneDrive ablegen
    const r = await belegPdf(b.id);
    setBusy(null);
    if (r.error) toast({ variant: "destructive", title: "PDF fehlgeschlagen", description: r.error });
    else {
      toast({
        title: "Festgeschrieben",
        description: b.typ === "gutschrift" && b.vorgaenger_id
          ? "Gutschrift gebucht — die Rechnung gilt jetzt als storniert."
          : b.project_id
            ? "Nummer vergeben, PDF im Projektordner „Anbote“ abgelegt — OneDrive folgt beim nächsten Abgleich."
            : "Nummer vergeben. Ohne Projekt bleibt das PDF nur in der App — über „PDF“ öffnen oder teilen.",
      });
      setVorschau({ open: true, url: r.url ?? null, blob: null, entwurf: false });
    }
    laden();
  };
  const pdfAnzeigen = async () => {
    if (!b) return;
    const token = ++vorschauToken.current;
    setBusy("pdf");
    setVorschau({ open: true, url: null, blob: null, entwurf });
    await wartenBisGespeichert();
    const r = await belegPdf(b.id);
    setBusy(null);
    if (token !== vorschauToken.current) return; // Fenster wurde inzwischen geschlossen
    if (r.error) { setVorschau({ open: false, url: null, blob: null, entwurf }); return toast({ variant: "destructive", title: "PDF fehlgeschlagen", description: r.error }); }
    if (r.base64) {
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      setVorschau({ open: true, url: URL.createObjectURL(blob), blob, entwurf: true });
    } else if (r.url) {
      setVorschau({ open: true, url: r.url, blob: null, entwurf: false });
    }
  };
  const vorschauSchliessen = () => { vorschauToken.current++; setVorschau({ open: false, url: null, blob: null, entwurf }); };

  const angebotBearbeiten = async () => {
    if (!b) return;
    const { error } = await supabase.from("belege").update({ status: "entwurf" }).eq("id", b.id);
    if (error) return toast({ variant: "destructive", title: "Nicht möglich", description: error.message });
    toast({ title: "In Bearbeitung", description: `${belegTitel(b)} kann jetzt geändert werden. Danach erneut festschreiben — die Nummer bleibt.` });
    laden();
  };
  const rechnungAusAngebot = async () => {
    if (!b || busy) return;
    setBusy("rechnung");
    const firma = await ladeFirmendaten();
    const { data: k } = b.customer_id
      ? await supabase.from("customers").select("reverse_charge, zahlungsziel_tage, uid").eq("id", b.customer_id).maybeSingle()
      : { data: null };
    const heute = heuteISO();
    const { data: neu, error } = await supabase.from("belege").insert({
      typ: "rechnung", project_id: b.project_id, customer_id: b.customer_id, vorgaenger_id: b.id,
      kunde_name: b.kunde_name, kunde_zusatz: b.kunde_zusatz, kunde_strasse: b.kunde_strasse, kunde_plz_ort: b.kunde_plz_ort, kunde_uid: b.kunde_uid ?? k?.uid ?? null, kunde_email: b.kunde_email,
      datum: heute, faellig_am: plusTage(heute, k?.zahlungsziel_tage ?? firma?.zahlungsziel_tage ?? 14),
      leistung_von: b.leistung_von ?? heute, leistung_bis: b.leistung_bis ?? heute,
      betreff: b.betreff, einleitung: firma?.rechnung_einleitung, schlusstext: firma?.rechnung_schluss,
      reverse_charge: !!k?.reverse_charge || b.reverse_charge, ust_satz: b.ust_satz,
      skonto_prozent: firma?.skonto_prozent ?? null, skonto_tage: firma?.skonto_tage ?? null,
    }).select().single();
    if (error || !neu) { setBusy(null); return toast({ variant: "destructive", title: "Fehler", description: error?.message }); }
    if (pos.length) {
      const { error: e2 } = await supabase.from("beleg_positionen").insert(pos.map((p) => ({
        beleg_id: neu.id, pos: p.pos, art: p.art, text: p.text, beschreibung: p.beschreibung, menge: p.menge, einheit: p.einheit, einzelpreis: p.einzelpreis, rabatt_prozent: p.rabatt_prozent, quelle_typ: "manuell", quelle_ids: [],
      })));
      if (e2) toast({ variant: "destructive", title: "Positionen nicht kopiert", description: e2.message });
    }
    await supabase.from("belege").update({ status: "angenommen" }).eq("id", b.id);
    setBusy(null);
    navigate(`/belege/${neu.id}`);
  };
  const stornieren = async () => {
    if (!b) return;
    setBusy("storno");
    const { data, error } = await supabase.rpc("beleg_stornieren", { p_beleg: b.id });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Storno nicht möglich", description: error.message });
    toast({ title: "Gutschrift vorbereitet", description: "Prüfen und festschreiben — erst dann gilt die Rechnung als storniert." });
    navigate(`/belege/${data}`);
  };
  const loeschen = async () => {
    if (!b) return;
    const { error } = await supabase.from("belege").delete().eq("id", b.id);
    if (error) return toast({ variant: "destructive", title: "Nicht gelöscht", description: error.message });
    navigate("/belege");
  };
  const zahlungSpeichern = async (text: string) => {
    if (!b) return;
    const betrag = parseZahl(text);
    if (betrag === null || betrag === 0) return toast({ variant: "destructive", title: "Betrag fehlt", description: "Bitte einen Betrag eingeben, z. B. 1250,00." });
    const { error } = await supabase.from("beleg_zahlungen").insert({ beleg_id: b.id, betrag, datum: zahlung.datum, art: zahlung.art as Zahlung["art"], notiz: zahlung.notiz || null });
    if (error) return toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
    setZahlungOpen(false); setZahlung({ betrag: "", datum: heuteISO(), art: "ueberweisung", notiz: "" }); laden();
  };
  const zahlungLoeschen = async (id: string) => {
    const { error } = await supabase.from("beleg_zahlungen").delete().eq("id", id);
    if (error) toast({ variant: "destructive", title: "Nicht gelöscht", description: error.message });
    setZahlungLoeschenId(null); laden();
  };
  const statusSetzen = async (status: Beleg["status"]) => {
    if (!b) return;
    const patch: Partial<Beleg> = { status };
    if (status === "gesendet" && !b.gesendet_am) patch.gesendet_am = new Date().toISOString();
    await kopf(patch);
  };

  const rest = useMemo(() => (b ? offen(b) : 0), [b]);
  if (!b) return <div className="min-h-screen bg-background"><PageHeader title="Beleg" backPath="/belege" /><p className="text-center text-muted-foreground py-10">Lade…</p></div>;

  const sortiert = [...pos].sort((a, c) => a.pos - c.pos || a.created_at.localeCompare(c.created_at));
  const folgeRechnung = nachfolger.find((n) => istRechnung(n.typ));
  const folgeGutschrift = nachfolger.find((n) => n.typ === "gutschrift");
  const loeschbar = entwurf && !b.nummer;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={belegTitel(b)} backPath="/belege" />
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-4 max-w-5xl">
        {/* Status + Aktionen */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge>
          {!entwurf && <span className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" /> festgeschrieben am {datum(b.festgeschrieben_am)}</span>}
          {entwurf && b.nummer && <span className="text-xs text-muted-foreground">Nummer {b.nummer} bleibt beim erneuten Festschreiben erhalten</span>}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={pdfAnzeigen} disabled={busy !== null}>
              {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}{entwurf ? "Vorschau" : "PDF"}
            </Button>
            {entwurf && b.project_id && rechnung && (
              <Button variant="outline" size="sm" className="gap-1" onClick={stundenLaden} disabled={busy !== null}><Clock className="h-4 w-4" />Stunden holen</Button>
            )}
            {!entwurf && istAngebot(b.typ) && b.status !== "angenommen" && (
              <Button variant="outline" size="sm" className="gap-1" onClick={angebotBearbeiten} disabled={busy !== null}><Pencil className="h-4 w-4" />Bearbeiten</Button>
            )}
            {entwurf && <Button size="sm" className="gap-1" onClick={() => setFrage("festschreiben")} disabled={busy !== null}>
              {busy === "fest" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}Festschreiben
            </Button>}
            {istAngebot(b.typ) && !entwurf && b.status !== "abgelehnt" && !folgeRechnung && (
              <Button variant="outline" size="sm" className="gap-1" onClick={rechnungAusAngebot} disabled={busy !== null}><ArrowRight className="h-4 w-4" />Rechnung erstellen</Button>
            )}
            {rechnung && !entwurf && b.status !== "storniert" && (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setZahlungOpen(true)}><Euro className="h-4 w-4" />Zahlung</Button>
            )}
            {rechnung && !entwurf && b.status !== "storniert" && !folgeGutschrift && (
              <Button variant="outline" size="sm" className="gap-1 text-destructive" onClick={() => setFrage("storno")} disabled={busy !== null}><Ban className="h-4 w-4" />Stornieren</Button>
            )}
            {loeschbar && <Button variant="ghost" size="sm" className="gap-1 text-destructive" onClick={() => setFrage("loeschen")}><Trash2 className="h-4 w-4" />Löschen</Button>}
          </div>
        </div>

        {/* Verknüpfungen — alles, was mit diesem Beleg zusammenhängt, ist einen Klick entfernt */}
        {(b.vorgaenger_id || nachfolger.length > 0) && (
          <div className="flex flex-wrap gap-2 text-sm">
            {b.vorgaenger_id && <Button variant="outline" size="sm" onClick={() => navigate(`/belege/${b.vorgaenger_id}`)}>{b.typ === "gutschrift" ? "Zur stornierten Rechnung" : "Zum Angebot"}</Button>}
            {nachfolger.map((n) => (
              <Button key={n.id} variant="outline" size="sm" className="gap-1" onClick={() => navigate(`/belege/${n.id}`)}>
                <Receipt className="h-4 w-4" />{TYP_LABEL[n.typ]} {n.nummer ?? "(Entwurf)"}{n.typ === "gutschrift" && n.status === "entwurf" ? " — noch nicht festgeschrieben" : ""}
              </Button>
            ))}
          </div>
        )}
        {folgeGutschrift?.status === "entwurf" && b.status !== "storniert" && (
          <p className="text-sm text-amber-700 dark:text-amber-400">Storno vorbereitet: Die Gutschrift muss noch festgeschrieben werden, erst dann gilt diese Rechnung als storniert.</p>
        )}
        {!entwurf && istAngebot(b.typ) && (
          <div className="flex flex-wrap gap-2 text-sm items-center">
            <span className="text-muted-foreground">Angebotsstatus:</span>
            {(["gesendet", "angenommen", "abgelehnt"] as const).map((s) => (
              <Button key={s} size="sm" variant={b.status === s ? "default" : "outline"} onClick={() => statusSetzen(s)}>{STATUS_LABEL[s]}</Button>
            ))}
          </div>
        )}
        {!entwurf && rechnung && b.status === "festgeschrieben" && (
          <Button size="sm" variant="outline" onClick={() => statusSetzen("gesendet")}>Als gesendet markieren</Button>
        )}

        {/* Kopf */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Empfänger</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input placeholder="Name / Firma" value={b.kunde_name} disabled={!entwurf} onChange={(e) => kopfLokal({ kunde_name: e.target.value })} onBlur={(e) => kopf({ kunde_name: e.target.value })} />
              <Input placeholder="Zusatz (Ansprechperson, Abteilung)" value={b.kunde_zusatz ?? ""} disabled={!entwurf} onChange={(e) => kopfLokal({ kunde_zusatz: e.target.value })} onBlur={(e) => kopf({ kunde_zusatz: e.target.value || null })} />
              <Input placeholder="Straße" value={b.kunde_strasse ?? ""} disabled={!entwurf} onChange={(e) => kopfLokal({ kunde_strasse: e.target.value })} onBlur={(e) => kopf({ kunde_strasse: e.target.value || null })} />
              <Input placeholder="PLZ Ort" value={b.kunde_plz_ort ?? ""} disabled={!entwurf} onChange={(e) => kopfLokal({ kunde_plz_ort: e.target.value })} onBlur={(e) => kopf({ kunde_plz_ort: e.target.value || null })} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="UID (ATU…)" value={b.kunde_uid ?? ""} disabled={!entwurf} onChange={(e) => kopfLokal({ kunde_uid: e.target.value })} onBlur={(e) => kopf({ kunde_uid: e.target.value || null })} />
                <Input placeholder="E-Mail" value={b.kunde_email ?? ""} disabled={!entwurf} onChange={(e) => kopfLokal({ kunde_email: e.target.value })} onBlur={(e) => kopf({ kunde_email: e.target.value || null })} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Belegdaten</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Datum</Label><Input type="date" value={b.datum} disabled={!entwurf} onChange={(e) => e.target.value && kopf({ datum: e.target.value })} /></div>
                {rechnung && <div className="space-y-1"><Label className="text-xs">Zahlbar bis *</Label><Input type="date" value={b.faellig_am ?? ""} disabled={!entwurf} onChange={(e) => kopf({ faellig_am: e.target.value || null })} /></div>}
                {b.typ === "angebot" && <div className="space-y-1"><Label className="text-xs">Gültig bis</Label><Input type="date" value={b.gueltig_bis ?? ""} disabled={!entwurf} onChange={(e) => kopf({ gueltig_bis: e.target.value || null })} /></div>}
                <div className="space-y-1"><Label className="text-xs">Leistung von{rechnung || b.typ === "gutschrift" ? " *" : ""}</Label><Input type="date" value={b.leistung_von ?? ""} disabled={!entwurf} onChange={(e) => kopf({ leistung_von: e.target.value || null })} /></div>
                <div className="space-y-1"><Label className="text-xs">Leistung bis</Label><Input type="date" value={b.leistung_bis ?? ""} disabled={!entwurf} onChange={(e) => kopf({ leistung_bis: e.target.value || null })} /></div>
              </div>
              {(rechnung || b.typ === "gutschrift") && <p className="text-[11px] text-muted-foreground">* Pflichtangaben auf der Rechnung (§ 11 UStG). „Stunden holen“ setzt den Leistungszeitraum automatisch.</p>}
              <div className="space-y-1"><Label className="text-xs">Betreff</Label><Input value={b.betreff ?? ""} disabled={!entwurf} onChange={(e) => kopfLokal({ betreff: e.target.value })} onBlur={(e) => kopf({ betreff: e.target.value || null })} /></div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Reverse Charge (§ 19 Abs. 1a UStG)</div>
                  <div className="text-xs text-muted-foreground">Bauleistung an Unternehmer: keine USt, UID des Kunden Pflicht.</div>
                </div>
                <Switch checked={b.reverse_charge} disabled={!entwurf} onCheckedChange={(v) => kopf({ reverse_charge: v })} />
              </div>
              {!b.reverse_charge && (
                <div className="flex items-center gap-2"><Label className="text-xs">USt-Satz</Label>
                  <Input type="text" inputMode="decimal" className="w-24 text-right" value={tipp["ust"] ?? zahl(b.ust_satz)} disabled={!entwurf}
                    onChange={(e) => setTipp((t) => ({ ...t, ust: e.target.value }))}
                    onBlur={(e) => { const n = parseZahl(e.target.value); setTipp((t) => { const { ust: _, ...r } = t; return r; }); if (n === null || n < 0 || n > 100) return toast({ variant: "destructive", title: "Ungültiger Steuersatz" }); if (n !== Number(b.ust_satz)) kopf({ ust_satz: n }); }} />
                  <span className="text-sm">%</span></div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Texte */}
        <Card>
          <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Einleitung</Label><Textarea rows={2} value={b.einleitung ?? ""} disabled={!entwurf} onChange={(e) => kopfLokal({ einleitung: e.target.value })} onBlur={(e) => kopf({ einleitung: e.target.value || null })} /></div>
            <div className="space-y-1"><Label className="text-xs">Schlusstext</Label><Textarea rows={2} value={b.schlusstext ?? ""} disabled={!entwurf} onChange={(e) => kopfLokal({ schlusstext: e.target.value })} onBlur={(e) => kopf({ schlusstext: e.target.value || null })} /></div>
          </CardContent>
        </Card>

        {/* Positionen */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Positionen</CardTitle>
            {entwurf && (
              <div className="flex gap-1 flex-wrap">
                <Button size="sm" variant="outline" className="gap-1" onClick={() => posNeu("position")} disabled={busy !== null}><Plus className="h-4 w-4" />Position</Button>
                <Button size="sm" variant="ghost" onClick={() => posNeu("ueberschrift")} disabled={busy !== null}>Überschrift</Button>
                <Button size="sm" variant="ghost" onClick={() => posNeu("text")} disabled={busy !== null}>Text</Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {sortiert.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Noch keine Positionen. {b.project_id && rechnung ? "„Stunden holen“ oder " : ""}„Position“ hinzufügen.</p>}
            {sortiert.map((p, i) => {
              let nr = 0; sortiert.slice(0, i + 1).forEach((x) => { if (x.art === "position") nr++; });
              const abzug = p.quelle_typ === "teilrechnung";
              return (
                <div key={p.id} className={`rounded-md border p-2 sm:p-3 space-y-2 ${p.art !== "position" ? "bg-muted/40" : ""} ${abzug ? "border-dashed" : ""}`}>
                  <div className="flex items-start gap-2">
                    <div className="w-8 shrink-0 text-sm text-muted-foreground pt-2 tabular-nums">{p.art === "position" ? nr : ""}</div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <Input className={p.art === "ueberschrift" ? "font-semibold" : ""} placeholder={p.art === "position" ? "Bezeichnung" : p.art === "ueberschrift" ? "Überschrift" : "Hinweistext"} value={p.text} disabled={!entwurf || abzug}
                        onChange={(e) => setPos((l) => l.map((x) => (x.id === p.id ? { ...x, text: e.target.value } : x)))}
                        onBlur={(e) => { if (e.target.value !== p.text || true) posSpeichern(p.id, { text: e.target.value }); }} />
                      {p.art === "position" && (
                        <>
                          {!abzug && <Textarea rows={1} placeholder="Beschreibung (optional)" value={p.beschreibung ?? ""} disabled={!entwurf}
                            onChange={(e) => setPos((l) => l.map((x) => (x.id === p.id ? { ...x, beschreibung: e.target.value } : x)))}
                            onBlur={(e) => posSpeichern(p.id, { beschreibung: e.target.value || null })} className="text-sm" />}
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                            {zahlFeld(p, "menge", "Menge")}
                            <div className="space-y-1"><Label className="text-[11px]">Einheit</Label>
                              <Select value={EINHEITEN.includes(p.einheit) ? p.einheit : "Stk"} disabled={!entwurf || abzug} onValueChange={(v) => posSpeichern(p.id, { einheit: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{EINHEITEN.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                              </Select></div>
                            {zahlFeld(p, "einzelpreis", "Einzelpreis €")}
                            {zahlFeld(p, "rabatt_prozent", "Rabatt %", 0, 100)}
                            <div className="space-y-1 text-right"><Label className="text-[11px]">Betrag</Label><div className="h-10 flex items-center justify-end font-semibold tabular-nums">{eur(p.gesamt)}</div></div>
                          </div>
                          {p.quelle_typ !== "manuell" && <div className="text-[11px] text-muted-foreground">{p.quelle_typ === "stunden" ? `Aus der Zeiterfassung: ${p.quelle_ids.length} Zeitblöcke` : abzug ? "Abzug einer festgeschriebenen Teilrechnung — Betrag ist fix" : p.quelle_typ}</div>}
                        </>
                      )}
                    </div>
                    {entwurf && (
                      <div className="flex flex-col shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => posVerschieben(p.id, -1)} aria-label="nach oben" disabled={abzug}><ChevronUp className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => posVerschieben(p.id, 1)} aria-label="nach unten" disabled={abzug}><ChevronDown className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => posLoeschen(p.id)} aria-label="löschen"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Summen */}
            <div className="ml-auto max-w-sm w-full space-y-1 pt-3 border-t text-sm">
              <div className="flex justify-between"><span>Summe netto</span><span className="tabular-nums">{eur(b.netto)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>{b.reverse_charge ? "USt: Übergang der Steuerschuld" : `zzgl. ${zahl(b.ust_satz)} % USt`}</span><span className="tabular-nums">{eur(b.ust)}</span></div>
              <div className="flex justify-between font-bold text-base pt-1 border-t"><span>{b.typ === "gutschrift" ? "Gutschrift" : rechnung ? "Rechnungsbetrag" : "Angebotssumme"}</span><span className="tabular-nums">{eur(b.brutto)}</span></div>
              {rechnung && !entwurf && b.status !== "storniert" && (
                <div className="flex justify-between text-muted-foreground"><span>bezahlt {eur(b.bezahlt)}</span><span className={`tabular-nums ${rest > 0 ? "text-destructive font-medium" : "text-green-700"}`}>{rest > 0 ? `offen ${eur(rest)}` : "vollständig bezahlt"}</span></div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Zahlungen */}
        {rechnung && !entwurf && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Zahlungen</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {zahlungen.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Zahlung erfasst.</p>}
              {zahlungen.map((z) => (
                <div key={z.id} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0">{datum(z.datum)}</span>
                  <span className="flex-1 min-w-0 truncate text-muted-foreground">{z.art === "ueberweisung" ? "Überweisung" : z.art === "bar" ? "Bar" : z.art === "skonto" ? "Skonto" : "Sonstiges"}{z.notiz ? ` · ${z.notiz}` : ""}</span>
                  <span className="tabular-nums font-medium">{eur(z.betrag)}</span>
                  {b.status !== "storniert" && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZahlungLoeschenId(z.id)} aria-label="Zahlung löschen"><Trash2 className="h-3.5 w-3.5" /></Button>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="space-y-1"><Label className="text-xs">Interne Notiz (nie am PDF)</Label><Textarea rows={2} value={b.notizen ?? ""} onChange={(e) => kopfLokal({ notizen: e.target.value })} onBlur={(e) => kopf({ notizen: e.target.value || null })} /></div>
      </main>

      {/* Stunden holen */}
      <Dialog open={stundenOpen} onOpenChange={setStundenOpen}>
        <DialogContent className="max-w-sm sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Offene Stunden übernehmen</DialogTitle>
            <DialogDescription>Nur Arbeitszeit des Projekts, Pausen bereits abgezogen, noch auf keiner Rechnung. Übernommene Stunden werden als abgerechnet markiert.</DialogDescription>
          </DialogHeader>
          {stunden.length === 0 ? <p className="text-sm text-muted-foreground py-4">Keine offenen Stunden für dieses Projekt.</p> : (
            <div className="space-y-2">
              {stunden.map((s, i) => (
                <div key={s.user_id ?? i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <Checkbox checked={s.gewaehlt} onCheckedChange={(v) => setStunden((l) => l.map((x, j) => (j === i ? { ...x, gewaehlt: !!v } : x)))} />
                  <div className="flex-1 min-w-[10rem]">
                    <div className="font-medium text-sm">{s.mitarbeiter}</div>
                    <div className="text-xs text-muted-foreground">{datum(s.von)}{s.von !== s.bis ? ` – ${datum(s.bis)}` : ""} · {s.bloecke} Einsätze · {s.gruppe ?? "kein Stundensatz zugeordnet"}</div>
                  </div>
                  <div className="font-semibold tabular-nums">{zahl(s.stunden)} h</div>
                  <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">×</span><Input className="w-24 text-right" inputMode="decimal" value={s.satzWert} placeholder="€/h" onChange={(e) => setStunden((l) => l.map((x, j) => (j === i ? { ...x, satzWert: e.target.value } : x)))} /><span className="text-xs">€/h</span></div>
                </div>
              ))}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setStundenOpen(false)}>Abbrechen</Button>
                <Button onClick={stundenUebernehmen} disabled={busy !== null || !stunden.some((s) => s.gewaehlt)}>{busy === "stunden" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Übernehmen"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Zahlung */}
      <Dialog open={zahlungOpen} onOpenChange={setZahlungOpen}>
        <DialogContent className="max-w-sm max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Zahlung erfassen</DialogTitle><DialogDescription>Offen: {eur(rest)} — leer lassen übernimmt den offenen Betrag.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Betrag €</Label><Input inputMode="decimal" value={zahlung.betrag} placeholder={rest.toFixed(2).replace(".", ",")} onChange={(e) => setZahlung({ ...zahlung, betrag: e.target.value })} /></div>
            <div className="space-y-1"><Label>Datum</Label><Input type="date" value={zahlung.datum} onChange={(e) => setZahlung({ ...zahlung, datum: e.target.value })} /></div>
            <div className="space-y-1"><Label>Art</Label>
              <Select value={zahlung.art} onValueChange={(v) => setZahlung({ ...zahlung, art: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ueberweisung">Überweisung</SelectItem><SelectItem value="bar">Bar</SelectItem><SelectItem value="skonto">Skonto-Abzug</SelectItem><SelectItem value="sonstiges">Sonstiges</SelectItem></SelectContent>
              </Select></div>
            <div className="space-y-1"><Label>Notiz</Label><Input value={zahlung.notiz} onChange={(e) => setZahlung({ ...zahlung, notiz: e.target.value })} /></div>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setZahlungOpen(false)}>Abbrechen</Button><Button onClick={() => zahlungSpeichern(zahlung.betrag || rest.toFixed(2))}>Speichern</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vorschau / PDF im Fenster */}
      <BelegVorschau
        open={vorschau.open}
        onClose={vorschauSchliessen}
        titel={belegTitel(b)}
        url={vorschau.url}
        blob={vorschau.blob}
        dateiname={`${TYP_DATEINAME[b.typ]} ${b.nummer ?? "Entwurf"}.pdf`}
        entwurf={vorschau.entwurf && !b.nummer}
      />

      {/* Sicherheitsabfragen */}
      <AlertDialog open={frage !== null || zahlungLoeschenId !== null} onOpenChange={(o) => { if (!o) { setFrage(null); setZahlungLoeschenId(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {zahlungLoeschenId ? "Zahlung löschen?" : frage === "festschreiben" ? (b.nummer ? "Erneut festschreiben?" : "Beleg festschreiben?") : frage === "storno" ? "Rechnung stornieren?" : "Entwurf löschen?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {zahlungLoeschenId && "Die Zahlung wird entfernt, der offene Betrag steigt entsprechend."}
              {!zahlungLoeschenId && frage === "festschreiben" && (b.nummer
                ? `${belegTitel(b)} wird mit der bestehenden Nummer erneut festgeschrieben, das PDF im Projektordner wird ersetzt.`
                : b.project_id
                  ? "Die nächste Nummer wird vergeben. Rechnungen sind danach unveränderbar; das PDF wird im Projektordner „Anbote“ abgelegt und nach OneDrive übertragen."
                  : "Die nächste Nummer wird vergeben. Rechnungen sind danach unveränderbar. Ohne Projekt bleibt das PDF nur in der App (kein OneDrive).")}
              {!zahlungLoeschenId && frage === "storno" && "Es wird eine Gutschrift über den vollen Betrag vorbereitet (als Entwurf zum Prüfen). Erst wenn die Gutschrift festgeschrieben ist, gilt die Rechnung als storniert und die Stunden werden wieder frei."}
              {!zahlungLoeschenId && frage === "loeschen" && "Der Entwurf wird gelöscht, übernommene Stunden werden wieder freigegeben."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (zahlungLoeschenId) { const id = zahlungLoeschenId; zahlungLoeschen(id); return; }
              const f = frage; setFrage(null); if (f === "festschreiben") festschreiben(); if (f === "storno") stornieren(); if (f === "loeschen") loeschen();
            }}>
              {zahlungLoeschenId ? "Löschen" : frage === "festschreiben" ? "Festschreiben" : frage === "storno" ? "Gutschrift vorbereiten" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BelegDetail;
