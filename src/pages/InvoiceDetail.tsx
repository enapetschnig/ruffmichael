import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Save, Download, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/PageHeader";

interface InvoiceItem {
  id?: string;
  position: number;
  beschreibung: string;
  menge: number;
  einheit: string;
  einzelpreis: number;
  gesamtpreis: number;
}

interface InvoiceData {
  typ: string;
  nummer: string;
  laufnummer: number;
  jahr: number;
  status: string;
  kunde_name: string;
  kunde_adresse: string;
  kunde_plz: string;
  kunde_ort: string;
  kunde_land: string;
  kunde_email: string;
  kunde_telefon: string;
  kunde_uid: string;
  datum: string;
  faellig_am: string;
  leistungsdatum: string;
  zahlungsbedingungen: string;
  notizen: string;
  mwst_satz: number;
  project_id: string | null;
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(isNew ? null : id || null);
  const [items, setItems] = useState<InvoiceItem[]>([
    { position: 1, beschreibung: "", menge: 1, einheit: "Stk.", einzelpreis: 0, gesamtpreis: 0 },
  ]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  const defaultTyp = searchParams.get("typ") || "rechnung";

  const [form, setForm] = useState<InvoiceData>({
    typ: defaultTyp,
    nummer: "",
    laufnummer: 0,
    jahr: new Date().getFullYear(),
    status: "entwurf",
    kunde_name: "",
    kunde_adresse: "",
    kunde_plz: "",
    kunde_ort: "",
    kunde_land: "Österreich",
    kunde_email: "",
    kunde_telefon: "",
    kunde_uid: "",
    datum: format(new Date(), "yyyy-MM-dd"),
    faellig_am: "",
    leistungsdatum: "",
    zahlungsbedingungen: "14 Tage netto",
    notizen: "",
    mwst_satz: 20,
    project_id: null,
  });

  useEffect(() => {
    fetchProjects();
    if (!isNew && id) loadInvoice(id);
  }, [id]);

  const fetchProjects = async () => {
    const { data } = await supabase.from("projects").select("id, name").order("name");
    if (data) setProjects(data);
  };

  const loadInvoice = async (invoiceId: string) => {
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (error || !data) {
      toast({ variant: "destructive", title: "Fehler", description: "Rechnung nicht gefunden" });
      navigate("/invoices");
      return;
    }

    setForm({
      typ: data.typ,
      nummer: data.nummer,
      laufnummer: data.laufnummer,
      jahr: data.jahr,
      status: data.status,
      kunde_name: data.kunde_name,
      kunde_adresse: data.kunde_adresse || "",
      kunde_plz: data.kunde_plz || "",
      kunde_ort: data.kunde_ort || "",
      kunde_land: data.kunde_land || "Österreich",
      kunde_email: data.kunde_email || "",
      kunde_telefon: data.kunde_telefon || "",
      kunde_uid: data.kunde_uid || "",
      datum: data.datum,
      faellig_am: data.faellig_am || "",
      leistungsdatum: data.leistungsdatum || "",
      zahlungsbedingungen: data.zahlungsbedingungen || "",
      notizen: data.notizen || "",
      mwst_satz: Number(data.mwst_satz),
      project_id: data.project_id,
    });

    // Load items
    const { data: itemsData } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("position");

    if (itemsData && itemsData.length > 0) {
      setItems(itemsData.map(it => ({
        id: it.id,
        position: it.position,
        beschreibung: it.beschreibung,
        menge: Number(it.menge),
        einheit: it.einheit || "Stk.",
        einzelpreis: Number(it.einzelpreis),
        gesamtpreis: Number(it.gesamtpreis),
      })));
    }

    setLoading(false);
  };

  const updateField = (field: keyof InvoiceData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const addItem = () => {
    setItems(prev => [...prev, {
      position: prev.length + 1,
      beschreibung: "",
      menge: 1,
      einheit: "Stk.",
      einzelpreis: 0,
      gesamtpreis: 0,
    }]);
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index).map((item, i) => ({ ...item, position: i + 1 })));
  };

  const updateItem = (index: number, field: keyof InvoiceItem, value: any) => {
    setItems(prev => {
      const updated = [...prev];
      (updated[index] as any)[field] = value;
      if (field === "menge" || field === "einzelpreis") {
        updated[index].gesamtpreis = Number(updated[index].menge) * Number(updated[index].einzelpreis);
      }
      return updated;
    });
  };

  const nettoSumme = items.reduce((sum, item) => sum + item.gesamtpreis, 0);
  const mwstBetrag = nettoSumme * (form.mwst_satz / 100);
  const bruttoSumme = nettoSumme + mwstBetrag;

  const handleSave = async () => {
    if (!form.kunde_name.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Kundenname ist erforderlich" });
      return;
    }
    if (items.length === 0 || !items[0].beschreibung.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Mindestens eine Position ist erforderlich" });
      return;
    }

    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Nicht angemeldet" });
      setSaving(false);
      return;
    }

    try {
      let savedId = invoiceId;

      if (isNew || !savedId) {
        // Get next number
        const { data: numData, error: numError } = await supabase.rpc("next_invoice_number", {
          p_typ: form.typ,
          p_jahr: form.jahr,
        });

        if (numError) throw numError;
        const nummer = numData as string;
        const laufnummer = parseInt(nummer.split("-")[2]);

        const { data: insertData, error: insertError } = await supabase
          .from("invoices")
          .insert({
            user_id: user.id,
            typ: form.typ,
            nummer,
            laufnummer,
            jahr: form.jahr,
            status: form.status,
            kunde_name: form.kunde_name,
            kunde_adresse: form.kunde_adresse || null,
            kunde_plz: form.kunde_plz || null,
            kunde_ort: form.kunde_ort || null,
            kunde_land: form.kunde_land || null,
            kunde_email: form.kunde_email || null,
            kunde_telefon: form.kunde_telefon || null,
            kunde_uid: form.kunde_uid || null,
            datum: form.datum,
            faellig_am: form.faellig_am || null,
            leistungsdatum: form.leistungsdatum || null,
            zahlungsbedingungen: form.zahlungsbedingungen || null,
            notizen: form.notizen || null,
            netto_summe: nettoSumme,
            mwst_satz: form.mwst_satz,
            mwst_betrag: mwstBetrag,
            brutto_summe: bruttoSumme,
            project_id: form.project_id || null,
          })
          .select("id, nummer")
          .single();

        if (insertError) throw insertError;
        savedId = insertData.id;
        setInvoiceId(savedId);
        updateField("nummer", insertData.nummer);
      } else {
        // Update existing
        const { error: updateError } = await supabase
          .from("invoices")
          .update({
            status: form.status,
            kunde_name: form.kunde_name,
            kunde_adresse: form.kunde_adresse || null,
            kunde_plz: form.kunde_plz || null,
            kunde_ort: form.kunde_ort || null,
            kunde_land: form.kunde_land || null,
            kunde_email: form.kunde_email || null,
            kunde_telefon: form.kunde_telefon || null,
            kunde_uid: form.kunde_uid || null,
            datum: form.datum,
            faellig_am: form.faellig_am || null,
            leistungsdatum: form.leistungsdatum || null,
            zahlungsbedingungen: form.zahlungsbedingungen || null,
            notizen: form.notizen || null,
            netto_summe: nettoSumme,
            mwst_satz: form.mwst_satz,
            mwst_betrag: mwstBetrag,
            brutto_summe: bruttoSumme,
            project_id: form.project_id || null,
          })
          .eq("id", savedId);

        if (updateError) throw updateError;
      }

      // Save items - delete existing and re-insert
      await supabase.from("invoice_items").delete().eq("invoice_id", savedId!);

      const itemsToInsert = items.map((item, idx) => ({
        invoice_id: savedId!,
        position: idx + 1,
        beschreibung: item.beschreibung,
        menge: item.menge,
        einheit: item.einheit,
        einzelpreis: item.einzelpreis,
        gesamtpreis: item.gesamtpreis,
      }));

      const { error: itemsError } = await supabase.from("invoice_items").insert(itemsToInsert);
      if (itemsError) throw itemsError;

      toast({ title: "Gespeichert", description: `${form.typ === "rechnung" ? "Rechnung" : "Angebot"} wurde gespeichert` });

      if (isNew) {
        navigate(`/invoices/${savedId}`, { replace: true });
      }
    } catch (err: any) {
      console.error("Fehler beim Speichern:", err);
      toast({ variant: "destructive", title: "Fehler", description: err.message || "Speichern fehlgeschlagen" });
    }

    setSaving(false);
  };

  const handleDownloadPdf = async () => {
    if (!invoiceId) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte zuerst speichern" });
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("generate-invoice-pdf", {
        body: { invoiceId },
      });

      if (error) throw error;

      // The edge function returns HTML encoded as base64
      const html = decodeURIComponent(escape(atob(data.pdf)));
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 500);
      }

      toast({ title: "PDF erstellt", description: "Die PDF wurde heruntergeladen" });
    } catch (err: any) {
      console.error("PDF-Fehler:", err);
      toast({ variant: "destructive", title: "PDF-Fehler", description: err.message || "PDF konnte nicht erstellt werden" });
    }
  };

  if (loading) return <div className="text-center py-8">Lädt...</div>;

  const typLabel = form.typ === "rechnung" ? "Rechnung" : "Angebot";

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <PageHeader
          title={isNew ? `Neue ${typLabel} erstellen` : `${typLabel} ${form.nummer}`}
          backPath="/invoices"
        />

        <div className="space-y-6">
          {/* Status & Typ */}
          {!isNew && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Badge variant="outline" className="text-lg px-4 py-1">{form.nummer}</Badge>
                    <Select value={form.status} onValueChange={(v) => updateField("status", v)}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="entwurf">Entwurf</SelectItem>
                        <SelectItem value="gesendet">Gesendet</SelectItem>
                        {form.typ === "rechnung" ? (
                          <>
                            <SelectItem value="bezahlt">Bezahlt</SelectItem>
                            <SelectItem value="storniert">Storniert</SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="angenommen">Angenommen</SelectItem>
                            <SelectItem value="abgelehnt">Abgelehnt</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleDownloadPdf} variant="outline" className="gap-2">
                    <Download className="w-4 h-4" />
                    PDF herunterladen
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Kundendaten */}
          <Card>
            <CardHeader>
              <CardTitle>Kundendaten</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Kundenname *</Label>
                  <Input value={form.kunde_name} onChange={(e) => updateField("kunde_name", e.target.value)} placeholder="Firmenname / Name" />
                </div>
                <div>
                  <Label>UID-Nummer</Label>
                  <Input value={form.kunde_uid} onChange={(e) => updateField("kunde_uid", e.target.value)} placeholder="ATU12345678" />
                </div>
              </div>
              <div>
                <Label>Adresse</Label>
                <Input value={form.kunde_adresse} onChange={(e) => updateField("kunde_adresse", e.target.value)} placeholder="Straße und Hausnummer" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label>PLZ</Label>
                  <Input value={form.kunde_plz} onChange={(e) => updateField("kunde_plz", e.target.value)} />
                </div>
                <div>
                  <Label>Ort</Label>
                  <Input value={form.kunde_ort} onChange={(e) => updateField("kunde_ort", e.target.value)} />
                </div>
                <div>
                  <Label>Land</Label>
                  <Input value={form.kunde_land} onChange={(e) => updateField("kunde_land", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>E-Mail</Label>
                  <Input type="email" value={form.kunde_email} onChange={(e) => updateField("kunde_email", e.target.value)} />
                </div>
                <div>
                  <Label>Telefon</Label>
                  <Input value={form.kunde_telefon} onChange={(e) => updateField("kunde_telefon", e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Rechnungsdetails */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Datum</Label>
                  <Input type="date" value={form.datum} onChange={(e) => updateField("datum", e.target.value)} />
                </div>
                <div>
                  <Label>Leistungsdatum</Label>
                  <Input type="date" value={form.leistungsdatum} onChange={(e) => updateField("leistungsdatum", e.target.value)} />
                </div>
                {form.typ === "rechnung" && (
                  <div>
                    <Label>Fällig am</Label>
                    <Input type="date" value={form.faellig_am} onChange={(e) => updateField("faellig_am", e.target.value)} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Zahlungsbedingungen</Label>
                  <Input value={form.zahlungsbedingungen} onChange={(e) => updateField("zahlungsbedingungen", e.target.value)} />
                </div>
                <div>
                  <Label>Projekt (optional)</Label>
                  <Select value={form.project_id || "none"} onValueChange={(v) => updateField("project_id", v === "none" ? null : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Kein Projekt" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Kein Projekt</SelectItem>
                      {projects.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>MwSt-Satz (%)</Label>
                <Input type="number" value={form.mwst_satz} onChange={(e) => updateField("mwst_satz", Number(e.target.value))} className="w-32" />
              </div>
            </CardContent>
          </Card>

          {/* Positionen */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Positionen</CardTitle>
                <Button onClick={addItem} variant="outline" size="sm" className="gap-1">
                  <Plus className="w-4 h-4" />
                  Position
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Pos.</TableHead>
                      <TableHead>Beschreibung</TableHead>
                      <TableHead className="w-20">Menge</TableHead>
                      <TableHead className="w-20">Einheit</TableHead>
                      <TableHead className="w-28">Einzelpreis</TableHead>
                      <TableHead className="w-28 text-right">Gesamt</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell>
                          <Input
                            value={item.beschreibung}
                            onChange={(e) => updateItem(idx, "beschreibung", e.target.value)}
                            placeholder="Beschreibung der Leistung"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={item.menge}
                            onChange={(e) => updateItem(idx, "menge", Number(e.target.value))}
                            min={0}
                            step={0.01}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.einheit}
                            onChange={(e) => updateItem(idx, "einheit", e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={item.einzelpreis}
                            onChange={(e) => updateItem(idx, "einzelpreis", Number(e.target.value))}
                            min={0}
                            step={0.01}
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          € {item.gesamtpreis.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {items.length > 1 && (
                            <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={5} className="text-right">Netto</TableCell>
                      <TableCell className="text-right font-medium">€ {nettoSumme.toFixed(2)}</TableCell>
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={5} className="text-right">MwSt ({form.mwst_satz}%)</TableCell>
                      <TableCell className="text-right">€ {mwstBetrag.toFixed(2)}</TableCell>
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={5} className="text-right font-bold text-lg">Brutto</TableCell>
                      <TableCell className="text-right font-bold text-lg">€ {bruttoSumme.toFixed(2)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Notizen */}
          <Card>
            <CardHeader>
              <CardTitle>Notizen</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={form.notizen}
                onChange={(e) => updateField("notizen", e.target.value)}
                placeholder="Zusätzliche Anmerkungen..."
                rows={3}
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => navigate("/invoices")}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              <Save className="w-4 h-4" />
              {saving ? "Speichert..." : "Speichern"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
