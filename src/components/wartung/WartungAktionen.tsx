import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Loader2, Mail, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MailSenden, type MailEntwurf } from "@/components/MailSenden";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getSessionUser } from "@/lib/auth";
import { heuteISO } from "@/lib/faktura";
import {
  datumAT, intervallText, ladeVorlage, mailAusVorlage, naechsterTermin, wartungAbschliessen, wartungRechnung,
  type WartungMitBezug,
} from "@/lib/wartung";

/**
 * Die drei Handgriffe einer fälligen Wartung — am Dashboard und in der Wartungsliste gleich:
 * Kunden per Mail-Vorlage anschreiben, Wartung abschließen (mit Folgetermin), Rechnung machen.
 */
export function WartungAktionen({ w, onGeaendert, kompakt = false }: {
  w: WartungMitBezug;
  onGeaendert: () => void;
  kompakt?: boolean;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mail, setMail] = useState<MailEntwurf | null>(null);
  const [abschlussOffen, setAbschlussOffen] = useState(false);
  const [erledigtAm, setErledigtAm] = useState(heuteISO());
  const [folge, setFolge] = useState(true);
  const [naechsteAm, setNaechsteAm] = useState("");
  const [mitRechnung, setMitRechnung] = useState(false);
  const [laeuft, setLaeuft] = useState<null | "mail" | "abschluss" | "rechnung">(null);

  const mailOeffnen = async () => {
    setLaeuft("mail");
    const vorlage = await ladeVorlage();
    setLaeuft(null);
    setMail(mailAusVorlage(vorlage, w));
  };

  const mailGesendet = async () => {
    await supabase.from("wartungen").update({ mail_gesendet_am: new Date().toISOString() }).eq("id", w.id);
    onGeaendert();
  };

  const abschlussStarten = () => {
    setErledigtAm(heuteISO());
    setNaechsteAm(naechsterTermin(w) ?? "");
    setFolge(!!w.intervall_monate);
    setMitRechnung(false);
    setAbschlussOffen(true);
  };

  const rechnungMachen = async (fuer = w) => {
    const user = await getSessionUser();
    const r = await wartungRechnung(fuer, user?.id ?? null);
    if (r.error) toast({ variant: "destructive", title: "Rechnung", description: r.error });
    if (r.belegId) navigate(`/belege/${r.belegId}`);
    return r;
  };

  const abschliessen = async () => {
    if (laeuft) return;
    if (!erledigtAm) return toast({ variant: "destructive", title: "Datum fehlt", description: "Wann wurde die Wartung gemacht?" });
    if (folge && !naechsteAm) return toast({ variant: "destructive", title: "Nächster Termin fehlt", description: "Bitte das Datum der nächsten Wartung eintragen — oder den Haken bei „Nächste Wartung“ entfernen." });
    setLaeuft("abschluss");
    const user = await getSessionUser();
    const r = await wartungAbschliessen(w, { erledigtAm, naechsteAm: folge ? naechsteAm : null, userId: user?.id ?? null });
    if (r.error) {
      setLaeuft(null);
      toast({ variant: "destructive", title: "Nicht abgeschlossen", description: r.error });
      onGeaendert();
      return;
    }
    toast({
      title: "Wartung abgeschlossen",
      description: folge ? `Die nächste Wartung ist am ${datumAT(naechsteAm)} eingetragen.` : undefined,
    });
    setAbschlussOffen(false);
    if (mitRechnung) await rechnungMachen({ ...w, status: "erledigt", erledigt_am: erledigtAm });
    setLaeuft(null);
    onGeaendert();
  };

  const rechnungKnopf = async () => {
    if (laeuft) return;
    setLaeuft("rechnung");
    await rechnungMachen();
    setLaeuft(null);
  };

  const groesse = kompakt ? "sm" : "default";
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {w.status === "offen" && (
          <Button size={groesse} variant="outline" className="gap-1.5" onClick={mailOeffnen} disabled={laeuft !== null}>
            {laeuft === "mail" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            E-Mail an Kunden
          </Button>
        )}
        {w.status === "offen" && (
          <Button size={groesse} className="gap-1.5" onClick={abschlussStarten} disabled={laeuft !== null}>
            <CheckCircle2 className="h-4 w-4" />
            Erledigt
          </Button>
        )}
        <Button size={groesse} variant="outline" className="gap-1.5" onClick={rechnungKnopf} disabled={laeuft !== null}>
          {laeuft === "rechnung" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
          {w.beleg_id ? "Zur Rechnung" : "Rechnung erstellen"}
        </Button>
      </div>

      <MailSenden
        open={!!mail}
        onOpenChange={(o) => !o && setMail(null)}
        entwurf={mail ?? {}}
        onGesendet={mailGesendet}
      />

      <Dialog open={abschlussOffen} onOpenChange={(o) => !laeuft && setAbschlussOffen(o)}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Wartung abschließen</DialogTitle>
            <DialogDescription className="break-words">{w.bezeichnung}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wartung-erledigt-am">Gemacht am</Label>
              <Input id="wartung-erledigt-am" type="date" value={erledigtAm} onChange={(e) => setErledigtAm(e.target.value)} />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox checked={folge} onCheckedChange={(v) => setFolge(v === true)} className="mt-0.5" />
                <span className="text-sm">
                  Nächste Wartung eintragen
                  {w.intervall_monate ? <span className="text-muted-foreground"> ({intervallText(w.intervall_monate)})</span> : null}
                </span>
              </label>
              {folge && (
                <Input aria-label="Nächste Wartung am" type="date" value={naechsteAm} onChange={(e) => setNaechsteAm(e.target.value)} />
              )}
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={mitRechnung} onCheckedChange={(v) => setMitRechnung(v === true)} className="mt-0.5" />
              <span className="text-sm">Gleich eine Rechnung dazu erstellen{w.beleg_id ? " (gibt es schon — wird geöffnet)" : ""}</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAbschlussOffen(false)} disabled={laeuft !== null}>Abbrechen</Button>
            <Button onClick={abschliessen} disabled={laeuft !== null} className="gap-1.5">
              {laeuft === "abschluss" && <Loader2 className="h-4 w-4 animate-spin" />}
              Abschließen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
