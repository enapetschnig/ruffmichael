import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Plus, FileText, Receipt, ArrowLeft, Filter } from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";

interface Invoice {
  id: string;
  typ: string;
  nummer: string;
  status: string;
  kunde_name: string;
  datum: string;
  brutto_summe: number;
  netto_summe: number;
  project_id: string | null;
}

const statusColors: Record<string, string> = {
  entwurf: "bg-muted text-muted-foreground",
  gesendet: "bg-blue-100 text-blue-800",
  bezahlt: "bg-green-100 text-green-800",
  storniert: "bg-red-100 text-red-800",
  abgelehnt: "bg-red-100 text-red-800",
  angenommen: "bg-green-100 text-green-800",
};

const statusLabels: Record<string, string> = {
  entwurf: "Entwurf",
  gesendet: "Gesendet",
  bezahlt: "Bezahlt",
  storniert: "Storniert",
  abgelehnt: "Abgelehnt",
  angenommen: "Angenommen",
};

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTyp, setFilterTyp] = useState<string>("alle");
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    const { data, error } = await supabase
      .from("invoices")
      .select("id, typ, nummer, status, kunde_name, datum, brutto_summe, netto_summe, project_id")
      .order("datum", { ascending: false });

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Rechnungen konnten nicht geladen werden" });
    } else {
      setInvoices(data || []);
    }
    setLoading(false);
  };

  const filtered = filterTyp === "alle" ? invoices : invoices.filter(i => i.typ === filterTyp);

  const totalRechnungen = invoices.filter(i => i.typ === "rechnung").length;
  const totalAngebote = invoices.filter(i => i.typ === "angebot").length;
  const offeneSumme = invoices
    .filter(i => i.typ === "rechnung" && i.status === "gesendet")
    .reduce((sum, i) => sum + Number(i.brutto_summe), 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <PageHeader title="Rechnungen & Angebote" backPath="/" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Rechnungen</CardDescription>
              <CardTitle className="text-2xl">{totalRechnungen}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Angebote</CardDescription>
              <CardTitle className="text-2xl">{totalAngebote}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Offene Rechnungen</CardDescription>
              <CardTitle className="text-2xl">€ {offeneSumme.toFixed(2)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <Filter className="w-5 h-5 text-muted-foreground" />
                <Select value={filterTyp} onValueChange={setFilterTyp}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alle">Alle</SelectItem>
                    <SelectItem value="rechnung">Rechnungen</SelectItem>
                    <SelectItem value="angebot">Angebote</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => navigate("/invoices/new?typ=angebot")} variant="outline" className="gap-2">
                  <FileText className="w-4 h-4" />
                  Neues Angebot
                </Button>
                <Button onClick={() => navigate("/invoices/new?typ=rechnung")} className="gap-2">
                  <Receipt className="w-4 h-4" />
                  Neue Rechnung
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-center py-8 text-muted-foreground">Lädt...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Receipt className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Noch keine Rechnungen oder Angebote erstellt</p>
                <Button className="mt-4" onClick={() => navigate("/invoices/new?typ=rechnung")}>
                  Erste Rechnung erstellen
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nummer</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead>Kunde</TableHead>
                      <TableHead>Datum</TableHead>
                      <TableHead className="text-right">Brutto</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((inv) => (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/invoices/${inv.id}`)}
                      >
                        <TableCell className="font-mono font-medium">{inv.nummer}</TableCell>
                        <TableCell>
                          <Badge variant={inv.typ === "rechnung" ? "default" : "secondary"}>
                            {inv.typ === "rechnung" ? "Rechnung" : "Angebot"}
                          </Badge>
                        </TableCell>
                        <TableCell>{inv.kunde_name}</TableCell>
                        <TableCell>{format(parseISO(inv.datum), "dd.MM.yyyy", { locale: de })}</TableCell>
                        <TableCell className="text-right font-medium">€ {Number(inv.brutto_summe).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge className={statusColors[inv.status] || ""}>
                            {statusLabels[inv.status] || inv.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
