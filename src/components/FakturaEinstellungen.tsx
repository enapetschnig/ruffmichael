import { useEffect, useState } from "react";
import { Save, Plus, Trash2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { eur, type Firmendaten, type Stundensatz, type Nummernkreis } from "@/lib/faktura";

/**
 * Einstellungen für Angebote & Rechnungen (nur Admin):
 *  1. Firmendaten (stehen auf jedem Beleg)
 *  2. Stundensätze + Zuordnung der Mitarbeiter
 *  3. Nummernkreise (Zählerstände — vor dem ersten Festschreiben prüfen!)
 */
export function FakturaEinstellungen() {
  const { toast } = useToast();
  const [firma, setFirma] = useState<Firmendaten | null>(null);
  const [saetze, setSaetze] = useState<Stundensatz[]>([]);
  const [kreise, setKreise] = useState<Nummernkreis[]>([]);
  const [profile, setProfile] = useState<{ id: string; vorname: string; nachname: string; stundensatz_id: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [neuSatz, setNeuSatz] = useState({ bezeichnung: "", satz: "" });

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

  const speichernFirma = async () => {
    if (!firma) return;
    setSaving(true);
    const { einzig: _e, updated_at: _u, ...rest } = firma;
    const { error } = await supabase.from("faktura_firmendaten").update(rest).eq("einzig", true);
    setSaving(false);
    toast(error
      ? { variant: "destructive", title: "Fehler", description: error.message }
      : { title: "Gespeichert", description: "Firmendaten aktualisiert." });
  };

  const satzAendern = async (id: string, patch: Partial<Stundensatz>) => {
    setSaetze((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await supabase.from("faktura_stundensaetze").update(patch).eq("id", id);
    if (error) toast({ variant: "destructive", title: "Fehler", description: error.message });
  };
  const satzAnlegen = async () => {
    const satz = Number(String(neuSatz.satz).replace(",", "."));
    if (!neuSatz.bezeichnung.trim() || !Number.isFinite(satz)) return;
    const { error } = await supabase.from("faktura_stundensaetze")
      .insert({ bezeichnung: neuSatz.bezeichnung.trim(), satz, sort_order: saetze.length + 1 });
    if (error) return toast({ variant: "destructive", title: "Fehler", description: error.message });
    setNeuSatz({ bezeichnung: "", satz: "" });
    laden();
  };
  const satzLoeschen = async (id: string) => {
    const { error } = await supabase.from("faktura_stundensaetze").delete().eq("id", id);
    if (error) return toast({ variant: "destructive", title: "Nicht möglich", description: "Satz ist noch Mitarbeitern zugeordnet oder in Verwendung." });
    laden();
  };
  const mitarbeiterSatz = async (profilId: string, satzId: string | null) => {
    setProfile((l) => l.map((p) => (p.id === profilId ? { ...p, stundensatz_id: satzId } : p)));
    await supabase.from("profiles").update({ stundensatz_id: satzId }).eq("id", profilId);
  };
  const kreisAendern = async (kreis: string, wert: string) => {
    const n = parseInt(wert, 10);
    if (!Number.isFinite(n) || n < 1) return;
    setKreise((l) => l.map((k) => (k.kreis === kreis ? { ...k, naechste_nummer: n } : k)));
    const { error } = await supabase.from("faktura_nummernkreise").update({ naechste_nummer: n }).eq("kreis", kreis);
    if (error) toast({ variant: "destructive", title: "Fehler", description: error.message });
  };

  if (!firma) return null;

  const feld = (k: keyof Firmendaten, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5 min-w-0">
      <Label htmlFor={`fd-${k}`}>{label}</Label>
      <Input id={`fd-${k}`} value={(firma[k] as string | number | null) ?? ""} onChange={(e) => set(k, e.target.value)} {...props} />
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {feld("zahlungsziel_tage", "Zahlungsziel (Tage)", { type: "number", min: 0 })}
            {feld("skonto_prozent", "Skonto %", { type: "number", step: "0.5", min: 0 })}
            {feld("skonto_tage", "Skonto-Tage", { type: "number", min: 0 })}
            {feld("angebot_gueltig_tage", "Angebot gültig (Tage)", { type: "number", min: 1 })}
            {feld("ust_satz", "USt-Satz %", { type: "number", step: "1", min: 0 })}
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
                <Input className="flex-1 min-w-[8rem]" value={s.bezeichnung} onChange={(e) => satzAendern(s.id, { bezeichnung: e.target.value })} />
                <div className="flex items-center gap-1">
                  <Input className="w-28 text-right" type="number" step="0.5" value={s.satz} onChange={(e) => satzAendern(s.id, { satz: Number(e.target.value) })} />
                  <span className="text-sm text-muted-foreground">€/h</span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => satzLoeschen(s.id)} aria-label="Satz löschen"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input className="flex-1 min-w-[8rem]" placeholder="Neue Gruppe, z. B. Vorarbeiter" value={neuSatz.bezeichnung} onChange={(e) => setNeuSatz({ ...neuSatz, bezeichnung: e.target.value })} />
              <Input className="w-28 text-right" placeholder="€/h" value={neuSatz.satz} onChange={(e) => setNeuSatz({ ...neuSatz, satz: e.target.value })} />
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nummernkreise</CardTitle>
          <CardDescription>Die nächste Nummer, die vergeben wird. Läuft je Belegart über die Jahre durch, das Jahr steht als Präfix davor (z. B. 2026-2584).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <span>Vor dem ersten Festschreiben mit dem alten Programm abgleichen: Die Zähler wurden aus den PDFs in OneDrive ermittelt (Rechnungen zuletzt 2583, Angebote 1150) — es kann neuere geben. Nach der ersten vergebenen Nummer nicht mehr zurückdrehen.</span>
          </div>
          <div className="space-y-4">
            {kreise.map((k) => {
              const jahr = new Date().getFullYear();
              const beispiel = `${k.praefix}${k.jahr_format === "JJJJ" ? `${jahr}${k.trenner}` : k.jahr_format === "JJ" ? `${String(jahr).slice(2)}${k.trenner}` : ""}${String(k.naechste_nummer).padStart(k.breite, "0")}`;
              const patch = (p: Partial<Nummernkreis>) => {
                setKreise((l) => l.map((x) => (x.kreis === k.kreis ? { ...x, ...p } : x)));
                supabase.from("faktura_nummernkreise").update(p).eq("kreis", k.kreis).then(({ error }) => {
                  if (error) toast({ variant: "destructive", title: "Fehler", description: error.message });
                });
              };
              return (
                <div key={k.kreis} className="rounded-md border p-3 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-medium">{k.kreis === "angebot" ? "Angebote / Auftragsbestätigungen" : k.kreis === "rechnung" ? "Rechnungen (auch Teil- und Schlussrechnungen)" : "Gutschriften"}</div>
                    <div className="text-sm text-muted-foreground">Nächste Nummer: <span className="font-mono font-semibold text-foreground">{beispiel}</span></div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div className="space-y-1"><Label className="text-xs">Nächste Nr.</Label><Input type="number" min={1} value={k.naechste_nummer} onChange={(e) => kreisAendern(k.kreis, e.target.value)} /></div>
                    <div className="space-y-1"><Label className="text-xs">Präfix</Label><Input value={k.praefix} placeholder="z. B. RE" onChange={(e) => patch({ praefix: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Jahr</Label>
                      <Select value={k.jahr_format || "keins"} onValueChange={(v) => patch({ jahr_format: v === "keins" ? "" : v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="JJJJ">2026</SelectItem><SelectItem value="JJ">26</SelectItem><SelectItem value="keins">kein Jahr</SelectItem></SelectContent>
                      </Select></div>
                    <div className="space-y-1"><Label className="text-xs">Trennzeichen</Label><Input value={k.trenner} onChange={(e) => patch({ trenner: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Stellen</Label><Input type="number" min={1} max={8} value={k.breite} onChange={(e) => patch({ breite: Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 4)) })} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default FakturaEinstellungen;
