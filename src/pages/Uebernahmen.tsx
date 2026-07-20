import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, FileCheck, FileText, Loader2, MapPin, Plus, Search } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UebernahmeDialog } from "@/components/UebernahmeDialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { projectLabel } from "@/lib/projectLabel";
import { isOffline } from "@/lib/offlineData";

// WICHTIG: Diese Seite wird von Mitarbeitern gesehen. Keine Preise anzeigen.

type Uebernahme = {
  id: string;
  kunde_name: string;
  auftrag_nr: string | null;
  datum: string;
  pdf_path: string | null;
  created_at: string;
  projects: {
    name: string;
    adresse: string | null;
    customers: { strasse: string | null; ort: string | null } | null;
  } | null;
};

const Uebernahmen = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [uebernahmen, setUebernahmen] = useState<Uebernahme[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      await fetchUebernahmen();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchUebernahmen = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("uebernahmen")
      .select("*, projects(name, adresse, customers(strasse, ort))")
      .order("created_at", { ascending: false });
    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Übernahmebestätigungen konnten nicht geladen werden",
      });
    } else {
      setUebernahmen((data as Uebernahme[]) ?? []);
    }
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return uebernahmen;
    return uebernahmen.filter((u) =>
      [u.kunde_name, u.auftrag_nr, u.projects ? projectLabel(u.projects) : null]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [uebernahmen, search]);

  const openPdf = async (u: Uebernahme) => {
    if (!u.pdf_path) return;
    // Signierte URL / PDF-Öffnen braucht Internet.
    if (isOffline()) {
      toast({
        variant: "destructive",
        title: "Nur mit Internet möglich",
        description: "Das PDF kann nur mit Internetverbindung geöffnet werden.",
      });
      return;
    }
    setPdfBusyId(u.id);
    const { data, error } = await supabase.storage
      .from("project-files")
      .createSignedUrl(u.pdf_path, 3600);
    setPdfBusyId(null);
    if (error || !data?.signedUrl) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "PDF konnte nicht geöffnet werden",
      });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const createPdf = async (u: Uebernahme) => {
    // Nachträgliche PDF-Erstellung für einen bestehenden Eintrag nur mit Internet.
    if (isOffline()) {
      toast({
        variant: "destructive",
        title: "Nur mit Internet möglich",
        description: "Das PDF kann nur mit Internetverbindung erstellt werden.",
      });
      return;
    }
    setPdfBusyId(u.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-uebernahme-pdf", {
        body: { uebernahmeId: u.id },
      });
      if (error || !data?.success) {
        throw new Error(error?.message || "PDF-Erstellung fehlgeschlagen");
      }
      toast({
        title: "PDF erstellt",
        description: "Übernahmebestätigung als PDF im Projektordner (Abnahme Protokoll) gespeichert",
      });
      await fetchUebernahmen();
      if (data.signedUrl) {
        window.open(data.signedUrl, "_blank");
      }
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "PDF-Erstellung fehlgeschlagen",
        description: error instanceof Error ? error.message : "Bitte erneut versuchen",
      });
    } finally {
      setPdfBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Übernahmebestätigungen" backPath="/" />

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-6 max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <FileCheck className="h-6 w-6 text-primary" />
              Übernahmen
              <Badge variant="secondary">{uebernahmen.length}</Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              Unterschriebene Übernahmebestätigungen mit PDF im Projektordner
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Neue Übernahmebestätigung</span>
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suchen (Kunde, Projekt, Auftrag Nr.)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <p className="text-center text-muted-foreground py-8">Lade Übernahmebestätigungen...</p>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {uebernahmen.length === 0
                ? "Noch keine Übernahmebestätigungen. Erstelle die erste!"
                : "Keine Übernahmebestätigungen gefunden."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((u) => (
              <Card key={u.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-base">{u.kunde_name}</span>
                        {u.pdf_path ? (
                          <Badge className="bg-green-600 text-white hover:bg-green-600 gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            PDF gespeichert
                          </Badge>
                        ) : (
                          <Badge variant="outline">Ohne PDF</Badge>
                        )}
                      </div>
                      {u.projects && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{projectLabel(u.projects)}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {u.auftrag_nr && <span>Auftrag Nr. {u.auftrag_nr}</span>}
                        <span>{format(new Date(u.datum), "dd.MM.yyyy")}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {u.pdf_path ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={pdfBusyId === u.id}
                          onClick={() => openPdf(u)}
                        >
                          {pdfBusyId === u.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                          PDF öffnen
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={pdfBusyId === u.id}
                          onClick={() => createPdf(u)}
                        >
                          {pdfBusyId === u.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                          PDF erstellen
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <UebernahmeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={fetchUebernahmen}
      />
    </div>
  );
};

export default Uebernahmen;
