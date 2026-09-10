import { useEffect, useMemo, useState } from "react";
import { FolderPlus, Loader2, Search, Check, Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { projectLabel } from "@/lib/projectLabel";
import { cn } from "@/lib/utils";
import type { Mail, MailAnhang } from "@/lib/postfach";

export type ProjektOpt = { id: string; name: string; plz: string | null; adresse: string | null; status: string };

/**
 * Mail einem Projekt zuordnen.
 *
 * Die Mail selbst bleibt in der App und erscheint beim Projekt unter
 * „Schriftverkehr“ — dort sieht man sie samt Verlauf und Anhängen.
 * Auf Wunsch wandern die Anhänge zusätzlich in den Projektordner „Mail“,
 * dann liegen sie über den Abgleich auch in OneDrive.
 */
export function MailZuProjekt({ open, onOpenChange, mail, anhaenge, projekte, onFertig }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mail: Mail | null;
  anhaenge: MailAnhang[];
  projekte: ProjektOpt[];
  onFertig: (projektId: string | null) => void;
}) {
  const { toast } = useToast();
  const [suche, setSuche] = useState("");
  const [ziel, setZiel] = useState<string>("");
  const [mitDateien, setMitDateien] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  const anlagen = useMemo(() => anhaenge.filter((a) => a.pfad), [anhaenge]);

  useEffect(() => {
    if (!open) return;
    setSuche("");
    setZiel(mail?.project_id ?? "");
    setMitDateien(false);
  }, [open, mail?.project_id]);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const liste = q
      ? projekte.filter((p) => `${p.name} ${p.adresse ?? ""} ${p.plz ?? ""}`.toLowerCase().includes(q))
      : projekte;
    // Laufende Projekte zuerst — die sucht man in neun von zehn Fällen
    return [...liste].sort((a, b) => (a.status === b.status ? 0 : a.status === "aktiv" ? -1 : 1)).slice(0, 60);
  }, [projekte, suche]);

  const speichern = async () => {
    if (!mail || !ziel) return;
    setLaeuft(true);
    try {
      const { error } = await supabase.from("mails").update({ project_id: ziel }).eq("id", mail.id);
      if (error) throw new Error(error.message);

      let kopiert = 0;
      if (mitDateien && anlagen.length) {
        for (const a of anlagen) {
          const { data, error: e1 } = await supabase.storage.from("mail-anhaenge").download(a.pfad!);
          if (e1 || !data) continue;
          // Ordner „Mail“ — so heißt er auch in Michaels OneDrive-Projektordnern
          const pfad = `${ziel}/Mail/${a.name.replace(/[\\/:*?"<>|]/g, "-")}`;
          const { error: e2 } = await supabase.storage.from("project-files").upload(pfad, data, { upsert: true, contentType: a.mime ?? undefined });
          if (!e2) kopiert++;
        }
      }

      const name = projekte.find((p) => p.id === ziel);
      toast({
        title: "Dem Projekt zugeordnet",
        description: `${name ? projectLabel(name as never) : "Projekt"} — unter „Schriftverkehr“ zu finden${kopiert ? `, ${kopiert} Datei(en) im Ordner „Mail“` : ""}.`,
      });
      onFertig(ziel);
      onOpenChange(false);
    } catch (e) {
      toast({ variant: "destructive", title: "Nicht zugeordnet", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLaeuft(false);
    }
  };

  const entfernen = async () => {
    if (!mail) return;
    setLaeuft(true);
    const { error } = await supabase.from("mails").update({ project_id: null }).eq("id", mail.id);
    setLaeuft(false);
    if (error) return toast({ variant: "destructive", title: "Nicht geändert", description: error.message });
    toast({ title: "Zuordnung entfernt" });
    onFertig(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!laeuft) onOpenChange(o); }}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-md max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mail einem Projekt zuordnen</DialogTitle>
          <DialogDescription>
            Sie erscheint dann beim Projekt unter „Schriftverkehr“ — mit Text und Anhängen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Projekt suchen…" className="pl-8" autoFocus />
          </div>

          <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {treffer.length === 0 && <p className="p-3 text-center text-sm text-muted-foreground">Kein Projekt gefunden.</p>}
            {treffer.map((p) => (
              <button key={p.id} type="button" onClick={() => setZiel(p.id)}
                className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent", ziel === p.id && "bg-primary/10 font-medium")}>
                <span className="flex-1 min-w-0 truncate">{projectLabel(p as never)}</span>
                {p.status !== "aktiv" && <span className="text-xs text-muted-foreground shrink-0">{p.status}</span>}
                {ziel === p.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>

          {anlagen.length > 0 && (
            <label className="flex items-start gap-2 rounded-md border p-2.5 cursor-pointer">
              <Checkbox checked={mitDateien} onCheckedChange={(v) => setMitDateien(!!v)} className="mt-0.5" />
              <span className="flex-1 min-w-0 text-sm">
                <span className="flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" />{anlagen.length} Anhang{anlagen.length > 1 ? "/Anhänge" : ""} zusätzlich ablegen</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Kopie in den Projektordner „Mail“ — landet damit auch in OneDrive.
                </span>
              </span>
            </label>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {mail?.project_id && (
              <Button variant="ghost" onClick={entfernen} disabled={laeuft}>Zuordnung entfernen</Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={laeuft}>Abbrechen</Button>
            <Button onClick={speichern} disabled={!ziel || laeuft} className="gap-2">
              {laeuft ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}Zuordnen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MailZuProjekt;
