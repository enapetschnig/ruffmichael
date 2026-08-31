// ============================================================================
// NeuerungenPflege — Neuerungen veröffentlichen (Adminbereich).
//
// Was hier eingetragen wird, erscheint allen Benutzern EINMAL oben auf der
// Startseite (NeuerungenBanner) samt Hinweis, die App neu zu laden.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { Megaphone, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Neuerung { id: string; titel: string; text: string | null; created_at: string }
const neuerungenTable = () => (supabase.from("neuerungen" as never) as any);

export function NeuerungenPflege() {
  const { toast } = useToast();
  const [liste, setListe] = useState<Neuerung[]>([]);
  const [titel, setTitel] = useState("");
  const [text, setText] = useState("");
  const [speichert, setSpeichert] = useState(false);

  const laden = useCallback(async () => {
    const { data } = await neuerungenTable()
      .select("id, titel, text, created_at").order("created_at", { ascending: false }).limit(30);
    setListe((data as Neuerung[]) || []);
  }, []);
  useEffect(() => { void laden(); }, [laden]);

  const anlegen = async () => {
    if (!titel.trim()) {
      toast({ variant: "destructive", title: "Titel fehlt", description: "Bitte kurz benennen, was neu ist." });
      return;
    }
    setSpeichert(true);
    const { error } = await neuerungenTable().insert({ titel: titel.trim(), text: text.trim() || null });
    setSpeichert(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setTitel(""); setText("");
    toast({ title: "Veröffentlicht", description: "Die Meldung erscheint allen einmal auf der Startseite." });
    void laden();
  };

  const loeschen = async (n: Neuerung) => {
    if (!window.confirm(`Meldung „${n.titel}" löschen?`)) return;
    const { error } = await neuerungenTable().delete().eq("id", n.id);
    if (error) { toast({ variant: "destructive", title: "Fehler", description: error.message }); return; }
    void laden();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="h-5 w-5 text-kb-blue-dark" />
          Neuerungen melden
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Erscheint allen Benutzern <b>einmal</b> oben auf der Startseite — mit dem Hinweis,
          die App neu zu laden. Nach dem Bestätigen ist die Meldung weg.
        </p>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label>Was ist neu?</Label>
            <Input value={titel} onChange={(e) => setTitel(e.target.value)}
              placeholder="z. B. Summe in der Belegliste gleich sichtbar" />
          </div>
          <div className="space-y-1">
            <Label>Kurz erklärt (optional)</Label>
            <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Wo findet man es, wie wird es bedient?" />
          </div>
          <Button onClick={() => void anlegen()} disabled={speichert}>
            {speichert ? "Wird veröffentlicht …" : "Veröffentlichen"}
          </Button>
        </div>

        {liste.length > 0 && (
          <div className="divide-y rounded-md border">
            {liste.map((n) => (
              <div key={n.id} className="flex items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{n.titel}</div>
                  {n.text && <div className="text-xs text-muted-foreground">{n.text}</div>}
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString("de-AT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10"
                  title="Meldung löschen" onClick={() => void loeschen(n)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
