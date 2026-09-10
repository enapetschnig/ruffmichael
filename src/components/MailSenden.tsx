import { useEffect, useState } from "react";
import { Send, Loader2, Paperclip, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { outlook, dateiGroesse } from "@/lib/postfach";

export type MailAnlage = { bucket: string; pfad: string; name: string; groesse?: number | null };

export type MailEntwurf = {
  an?: string;
  cc?: string;
  betreff?: string;
  text?: string;
  dateien?: MailAnlage[];
  /** Beleg, der nach dem Senden als „gesendet" gilt (Angebot, Rechnung …) */
  belegId?: string;
};

const gueltig = (a: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(a.trim());
const zerlegen = (s: string) => s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);

/**
 * Mail schreiben und über das Firmenpostfach verschicken.
 *
 * Der Versand läuft über Microsoft 365 (office@ruffinstallateur.at), die Mail
 * landet dadurch auch in Michaels „Gesendete Elemente“ — er sieht in Outlook
 * also alles, was die App verschickt. Anhänge werden nie durch den Browser
 * geschleust, sondern nur als Verweis auf den Speicher übergeben.
 */
export function MailSenden({ open, onOpenChange, entwurf, onGesendet }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entwurf: MailEntwurf;
  onGesendet?: () => void;
}) {
  const { toast } = useToast();
  const [an, setAn] = useState("");
  const [cc, setCc] = useState("");
  const [betreff, setBetreff] = useState("");
  const [text, setText] = useState("");
  const [dateien, setDateien] = useState<MailAnlage[]>([]);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAn(entwurf.an ?? "");
    setCc(entwurf.cc ?? "");
    setBetreff(entwurf.betreff ?? "");
    setText(entwurf.text ?? "");
    setDateien(entwurf.dateien ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const senden = async () => {
    const empfaenger = zerlegen(an);
    if (!empfaenger.length) return toast({ variant: "destructive", title: "Empfänger fehlt", description: "Bitte mindestens eine E-Mail-Adresse eingeben." });
    const falsch = [...empfaenger, ...zerlegen(cc)].find((a) => !gueltig(a));
    if (falsch) return toast({ variant: "destructive", title: "Adresse stimmt nicht", description: `„${falsch}“ sieht nicht wie eine E-Mail-Adresse aus.` });
    if (!betreff.trim()) return toast({ variant: "destructive", title: "Betreff fehlt", description: "Ohne Betreff landet die Mail leicht im Spam." });
    setLaeuft(true);
    try {
      await outlook("senden", {
        an: empfaenger,
        cc: zerlegen(cc),
        betreff: betreff.trim(),
        text,
        dateien: dateien.map((d) => ({ bucket: d.bucket, pfad: d.pfad, name: d.name })),
        beleg_id: entwurf.belegId,
      });
      toast({ title: "Mail verschickt", description: `An ${empfaenger.join(", ")}${dateien.length ? ` mit ${dateien.length} Anhang${dateien.length > 1 ? "/Anhängen" : ""}` : ""}. Die Kopie liegt in „Gesendete Elemente“.` });
      onOpenChange(false);
      onGesendet?.();
    } catch (e) {
      toast({ variant: "destructive", title: "Mail nicht verschickt", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!laeuft) onOpenChange(o); }}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mail schreiben</DialogTitle>
          <DialogDescription>Wird über das Firmenpostfach verschickt und liegt danach in Outlook unter „Gesendete Elemente“.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mail-an">An</Label>
            <Input id="mail-an" value={an} onChange={(e) => setAn(e.target.value)} placeholder="kunde@beispiel.at" inputMode="email" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail-cc">Kopie (CC) <span className="text-muted-foreground font-normal">— optional</span></Label>
            <Input id="mail-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="buero@beispiel.at" inputMode="email" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail-betreff">Betreff</Label>
            <Input id="mail-betreff" value={betreff} onChange={(e) => setBetreff(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail-text">Nachricht</Label>
            <Textarea id="mail-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} className="resize-y" />
          </div>
          {dateien.length > 0 && (
            <div className="space-y-1.5">
              <Label>Anhänge</Label>
              <div className="space-y-1">
                {dateien.map((d) => (
                  <div key={d.pfad} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 min-w-0 truncate">{d.name}</span>
                    {d.groesse ? <span className="text-xs text-muted-foreground shrink-0">{dateiGroesse(d.groesse)}</span> : null}
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setDateien((l) => l.filter((x) => x.pfad !== d.pfad))} aria-label={`${d.name} entfernen`}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={laeuft}>Abbrechen</Button>
            <Button onClick={senden} disabled={laeuft} className="gap-2">
              {laeuft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Verschicken
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MailSenden;
