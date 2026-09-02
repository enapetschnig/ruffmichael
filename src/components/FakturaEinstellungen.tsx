import { useEffect, useState } from "react";
import { Save, Plus, Trash2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { eur, zahl, parseZahl, type Firmendaten, type Stundensatz, type Nummernkreis } from "@/lib/faktura";

/**
 * Einstellungen für Angebote & Rechnungen (nur Admin):
 *  1. Firmendaten (stehen auf jedem Beleg)
 *  2. Stundensätze + Zuordnung der Mitarbeiter
 *  3. Nummernkreise (Format + nächste Nummer — vor dem ersten Festschreiben prüfen!)
 *
 * Zahlenfelder sind Textfelder mit Komma-Unterstützung und werden erst beim
 * Verlassen gespeichert — kein Zwischenwert landet in der Datenbank.
 */
export function FakturaEinstellungen() {
  const { toast } = useToast();
  const [firma, setFirma] = useState<Firmendaten | null>(null);
  const [saetze, setSaetze] = useState<Stundensatz[]>([]);
  const [kreise, setKreise] = useState<Nummernkreis[]>([]);
  const [profile, setProfile] = useState<{ id: string; vorname: string; nachname: string; stundensatz_id: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [neuSatz, setNeuSatz] = useState({ bezeichnung: "", satz: "" });
  const [satzLoeschenId, setSatzLoeschenId] = useState<string | null>(null);
  // Textzustand der Zahlenfelder (bis zum Verlassen)
  const [tipp, setTipp] = useState<Record<string, string>>({});

  const laden = async () => {
    const [f, s, k, p] = await Promise.all([
      supabase.from("faktura_firmendaten").select("*").eq("einzig", true).maybeSingle(),
      supabase.from("faktura_stundensaetze").select("*").order("sort_order"),
      supabase.from("faktura_nummernkreise").select("*").order("kreis"),
      supabase.from("profiles").select("id, vorname, nachname, stundensatz_id").eq("is_active", true).order("nachname"),
    ]);
    setFirma(f.data ?? null);
    setSaetze(s.data ?? []);
    setKreise(k.data ?? []);
    setProfile(p.data ?? []);
  };
  useEffect(() => { laden(); }, []);

  const set = (k: keyof Firmendaten, v: string | number | null) => setFirma((f) => (f ? { ...f, [k]: v } : f));

  // ── Firmendaten ──────────────────────────────────────────────────────────
  const speichernFirma = async () => {
    if (!firma) return;
    const { einzig: _e, updated_at: _u, ...rest } = firma;
    // Zahlenfelder bereinigen: leer → NULL bzw. Standard, Komma → Punkt
    const num = (v: unknown) => (v === "" || v == null ? null : parseZahl(String(v)));
    const bereinigt = {
      ...rest,
      firma: String(rest.firma ?? "").trim(),
      skonto_prozent: num(rest.skonto_prozent),
      skonto_tage: num(rest.skonto_tage),
      zahlungsziel_tage: num(rest.zahlungsziel_tage) ?? 14,
      angebot_gueltig_tage: num(rest.angebot_gueltig_tage) ?? 30,
      ust_satz: num(rest.ust_satz) ?? 20,
    };
    if (!bereinigt.firma) return toast({ variant: "destructive", title: "Firma fehlt", description: "Der Firmenname steht auf jedem Beleg." });
    if ([bereinigt.skonto_prozent, bereinigt.skonto_tage, bereinigt.zahlungsziel_tage, bereinigt.angebot_gueltig_tage, bereinigt.ust_satz].some((n) => n !== null && !Number.isFinite(n))) {
      return toast({ variant: "destructive", title: "Ungültige Zahl", description: "Bitte Tage und Prozent als Zahl eingeben, z. B. 14 oder 2,5." });
    }
    if ((bereinigt.skonto_prozent ?? 0) > 0 && !(bereinigt.skonto_tage ?? 0)) {
      return toast({ variant: "destructive", title: "Skonto-Frist fehlt", description: "Wenn Skonto gewährt wird, braucht es die Anzahl Tage." });
    }
    setSaving(true);
    const { error } = await supabase.from("faktura_firmendaten").update(bereinigt).eq("einzig", true);
    setSaving(false);
    if (error) return toast({ variant: "destructive", title: "Fehler", description: error.message });
    setFirma({ ...firma, ...bereinigt } as Firmendaten);
    toast({ title: "Gespeichert", description: "Firmendaten aktualisiert." });
  };

  // ── Stundensätze ─────────────────────────────────────────────────────────
  const satzAendern = async (id: string, patch: Partial<Stundensatz>) => {
    setSaetze((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await supabase.from("faktura_stundensaetze").update(patch).eq("id", id);
    if (error) toast({ variant: "destructive", title: "Fehler", description: error.message });
  };
  const satzAnlegen = async () => {
    const satz = parseZahl(neuSatz.satz);
    if (!neuSatz.bezeichnung.trim()) return toast({ variant: "destructive", title: "Bezeichnung fehlt" });
    if (satz === null || satz <= 0) return toast({ variant: "destructive", title: "Stundensatz fehlt", description: "Bitte einen Satz in €/h eingeben, z. B. 68." });
    const { error } = await supabase.from("faktura_stundensaetze")
      .insert({ bezeichnung: neuSatz.bezeichnung.trim(), satz, sort_order: saetze.length + 1 });
    if (error) return toast({ variant: "destructive", title: "Fehler", description: error.message });
    setNeuSatz({ bezeichnung: "", satz: "" });
    laden();
  };
  const satzLoeschen = async () => {
    const id = satzLoeschenId; setSatzLoeschenId(null);
    if (!id) return;
    const n = profile.filter((p) => p.stundensatz_id === id).length;
    if (n > 0) return toast({ variant: "destructive", title: "Noch zugeordnet", description: `${n} Mitarbeiter verwenden diesen Satz — zuerst unten umhängen.` });
    const { error } = await supabase.from("faktura_stundensaetze").delete().eq("id", id);
    if (error) return toast({ variant: "destructive", title: "Nicht möglich", description: error.message });
    laden();
  };
  const mitarbeiterSatz = async (profilId: string, satzId: string | null) => {
    setProfile((l) => l.map((p) => (p.id === profilId ? { ...p, stundensatz_id: satzId } : p)));
    const { error } = await supabase.from("profiles").update({ stundensatz_id: satzId }).eq("id", profilId);
    if (error) toast({ variant: "destructive", title: "Fehler", description: error.message });
  };

  // ── Nummernkreise ────────────────────────────────────────────────────────
  const kreisPatch = async (kreis: string, patch: Partial<Nummernkreis>) => {
    setKreise((l) => l.map((x) => (x.kreis === kreis ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("faktura_nummernkreise").update(patch).eq("kreis", kreis);
    if (error) { toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message.includes("praefix_chk") ? "Präfix: nur Buchstaben, Ziffern, Punkt, Strich (max. 10). Trennzeichen: max. 3 Zeichen." : error.message }); laden(); }
  };
  const naechsteNummerSpeichern = async (kreis: string, wert: string) => {
    const n = parseZahl(wert);
    if (n === null || n < 1 || !Number.isInteger(n)) return toast({ variant: "destructive", title: "Ungültige Nummer", description: "Bitte eine ganze Zahl ab 1 eingeben." });
    // Nie unter eine bereits vergebene Nummer drehen
    const { data: max } = await supabase.from("belege").select("laufnummer").eq("kreis", kreis).not("nummer", "is", null).order("laufnummer", { ascending: false }).limit(1).maybeSingle();
    if (max?.laufnummer && n <= max.laufnummer) {
      return toast({ variant: "destructive", title: "Zu klein", description: `Nummer ${max.laufnummer} ist schon vergeben — die nächste muss größer sein.` });
    }
    kreisPatch(kreis, { naechste_nummer: n });
  };

  if (!firma) return null;

  const feld = (k: keyof Firmendaten, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5 min-w-0">
      <Label htmlFor={`fd-${k}`}>{label}</Label>
      <Input id={`fd-${k}`} value={(firma[k] as string | number | null) ?? ""} onChange={(e) => set(k, e.target.value)} {...props} />
    </div>
  );
  const zahlFeld = (k: keyof Firmendaten, label: string) => (
    <div className="space-y-1.5 min-w-0">
      <Label htmlFor={`fd-${k}`}>{label}</Label>
      <Input id={`fd-${k}`} inputMode="decimal" value={(firma[k] as string | number | null) ?? ""} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Firmendaten für Angebote &amp; Rechnungen</CardTitle>
          <CardDescription>Stehen im Kopf und in der Fußzeile jedes Belegs. UID, Firmenbuch und Bankverbindung sind Pflichtangaben auf der Rechnung.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {feld("firma", "Firma *")}
            {feld("zusatz", "Zusatz / Slogan")}
            {feld("strasse", "Straße")}
            {feld("plz_ort", "PLZ Ort")}
            {feld("telefon", "Telefon")}
            {feld("email", "E-Mail")}
            {feld("web", "Website")}
            {feld("uid", "UID (ATU…)")}
            {feld("firmenbuch", "Firmenbuchnummer (FN)")}
            {feld("gericht", "Firmenbuchgericht")}
            {feld("bank", "Bank")}
            {feld("iban", "IBAN")}
            {feld("bic", "BIC")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {zahlFeld("zahlungsziel_tage", "Zahlungsziel (Tage)")}
            {zahlFeld("skonto_prozent", "Skonto % (leer = kein Skonto)")}
            {zahlFeld("skonto_tage", "Skonto-Tage")}
            {zahlFeld("angebot_gueltig_tage", "Angebot gültig (Tage)")}
            {zahlFeld("ust_satz", "USt-Satz %")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Angebot – Einleitung</Label><Textarea rows={2} value={firma.angebot_einleitung ?? ""} onChange={(e) => set("angebot_einleitung", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Angebot – Schlusstext</Label><Textarea rows={2} value={firma.angebot_schluss ?? ""} onChange={(e) => set("angebot_schluss", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Rechnung – Einleitung</Label><Textarea rows={2} value={firma.rechnung_einleitung ?? ""} onChange={(e) => set("rechnung_einleitung", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Rechnung – Schlusstext</Label><Textarea rows={2} value={firma.rechnung_schluss ?? ""} onChange={(e) => set("rechnung_schluss", e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Fußtext (auf jedem Beleg, z. B. Gerichtsstand, Eigentumsvorbehalt)</Label><Textarea rows={2} value={firma.fusstext ?? ""} onChange={(e) => set("fusstext", e.target.value)} /></div>
          <Button onClick={speichernFirma} disabled={saving} className="gap-2"><Save className="h-4 w-4" />Firmendaten speichern</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stundensätze</CardTitle>
          <CardDescription>Netto je Stunde. Beim „Stunden holen“ wird der Satz je Mitarbeiter vorgeschlagen und kann dort noch geändert werden.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {saetze.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2">
                <Input className="flex-1 min-w-[8rem]" value={s.bezeichnung} onChange={(e) => setSaetze((l) => l.map((x) => (x.id === s.id ? { ...x, bezeichnung: e.target.value } : x)))} onBlur={(e) => e.target.value.trim() && satzAendern(s.id, { bezeichnung: e.target.value.trim() })} />
                <div className="flex items-center gap-1">
                  <Input className="w-28 text-right" inputMode="decimal" value={tipp[`satz.${s.id}`] ?? zahl(s.satz)}
                    onChange={(e) => setTipp((t) => ({ ...t, [`satz.${s.id}`]: e.target.value }))}
                    onBlur={(e) => { const n = parseZahl(e.target.value); setTipp((t) => { const { [`satz.${s.id}`]: _, ...r } = t; return r; }); if (n === null || n <= 0) return toast({ variant: "destructive", title: "Ungültiger Satz", description: "Bitte z. B. 68 oder 72,5 eingeben." }); if (n !== Number(s.satz)) satzAendern(s.id, { satz: n }); }} />
                  <span className="text-sm text-muted-foreground">€/h</span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSatzLoeschenId(s.id)} aria-label="Satz löschen"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input className="flex-1 min-w-[8rem]" placeholder="Neue Gruppe, z. B. Vorarbeiter" value={neuSatz.bezeichnung} onChange={(e) => setNeuSatz({ ...neuSatz, bezeichnung: e.target.value })} />
              <Input className="w-28 text-right" inputMode="decimal" placeholder="€/h" value={neuSatz.satz} onChange={(e) => setNeuSatz({ ...neuSatz, satz: e.target.value })} />
              <Button variant="outline" size="sm" onClick={satzAnlegen} className="gap-1"><Plus className="h-4 w-4" />Anlegen</Button>
            </div>
          </div>
          <div className="border-t pt-4 space-y-2">
            <div className="text-sm font-medium">Zuordnung der Mitarbeiter</div>
            {profile.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="flex-1 min-w-0 truncate text-sm">{p.vorname} {p.nachname}</span>
                <Select value={p.stundensatz_id ?? "none"} onValueChange={(v) => mitarbeiterSatz(p.id, v === "none" ? null : v)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— kein Satz —</SelectItem>
                    {saetze.map((s) => <SelectItem key={s.id} value={s.id}>{s.bezeichnung} ({eur(s.satz)})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {profile.some((p) => !p.stundensatz_id) && <p className="text-xs text-amber-700 dark:text-amber-400">Mitarbeiter ohne Satz erscheinen beim „Stunden holen“ ohne Vorschlag — der Satz muss dann jedes Mal eingetippt werden.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nummernkreise</CardTitle>
          <CardDescription>Format und nächste Nummer je Belegart. Läuft über die Jahre durch, das Jahr steht als Präfix davor (z. B. 2026-2584).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <span>Vor dem ersten Festschreiben mit dem alten Programm abgleichen: Die Zähler wurden aus den PDFs in OneDrive ermittelt (Rechnungen zuletzt 2583, Angebote 1150) — es kann neuere geben. Nach der ersten vergebenen Nummer lässt sich der Zähler nur noch nach oben stellen.</span>
          </div>
          <div className="space-y-4">
            {kreise.map((k) => {
              const jahr = new Date().getFullYear();
              const beispiel = `${k.praefix}${k.jahr_format === "JJJJ" ? `${jahr}${k.trenner}` : k.jahr_format === "JJ" ? `${String(jahr).slice(2)}${k.trenner}` : ""}${String(k.naechste_nummer).padStart(k.breite, "0")}`;
              const key = `nr.${k.kreis}`;
              return (
                <div key={k.kreis} className="rounded-md border p-3 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-medium">{k.kreis === "angebot" ? "Angebote / Auftragsbestätigungen" : k.kreis === "rechnung" ? "Rechnungen (auch Teil- und Schlussrechnungen)" : "Gutschriften"}</div>
                    <div className="text-sm text-muted-foreground">Nächste Nummer: <span className="font-mono font-semibold text-foreground">{beispiel}</span></div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div className="space-y-1"><Label className="text-xs">Nächste Nr.</Label>
                      <Input inputMode="numeric" value={tipp[key] ?? String(k.naechste_nummer)}
                        onChange={(e) => setTipp((t) => ({ ...t, [key]: e.target.value }))}
                        onBlur={(e) => { const v = e.target.value; setTipp((t) => { const { [key]: _, ...r } = t; return r; }); if (v !== String(k.naechste_nummer)) naechsteNummerSpeichern(k.kreis, v); }} /></div>
                    <div className="space-y-1"><Label className="text-xs">Präfix</Label><Input value={k.praefix} placeholder="z. B. RE" maxLength={10} onChange={(e) => setKreise((l) => l.map((x) => (x.kreis === k.kreis ? { ...x, praefix: e.target.value } : x)))} onBlur={(e) => kreisPatch(k.kreis, { praefix: e.target.value.trim() })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Jahr</Label>
                      <Select value={k.jahr_format || "keins"} onValueChange={(v) => kreisPatch(k.kreis, { jahr_format: v === "keins" ? "" : v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="JJJJ">{jahr}</SelectItem><SelectItem value="JJ">{String(jahr).slice(2)}</SelectItem><SelectItem value="keins">kein Jahr</SelectItem></SelectContent>
                      </Select></div>
                    <div className="space-y-1"><Label className="text-xs">Trennzeichen</Label><Input value={k.trenner} maxLength={3} onChange={(e) => setKreise((l) => l.map((x) => (x.kreis === k.kreis ? { ...x, trenner: e.target.value } : x)))} onBlur={(e) => kreisPatch(k.kreis, { trenner: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Stellen</Label>
                      <Select value={String(k.breite)} onValueChange={(v) => kreisPatch(k.kreis, { breite: Number(v) })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{[3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                      </Select></div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={satzLoeschenId !== null} onOpenChange={(o) => !o && setSatzLoeschenId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stundensatz löschen?</AlertDialogTitle>
            <AlertDialogDescription>Bereits geschriebene Belege bleiben unverändert. Mitarbeitern, die diesen Satz nutzen, muss vorher ein anderer zugeordnet werden.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={satzLoeschen}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default FakturaEinstellungen;
