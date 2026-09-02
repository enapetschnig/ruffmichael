import { getSessionUser } from "@/lib/auth";
import { fetchCustomersCached } from "@/lib/cachedQueries";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Pencil, Trash2, Phone, Smartphone, Mail, MapPin, Truck, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { isOffline, newId, saveInsert } from "@/lib/offlineData";

export interface Customer {
  id: string;
  // Kundennummer aus der Faktura-Software (z.B. "0253"); nur bei importierten Kunden gesetzt
  kundennr?: string | null;
  vorname: string;
  nachname: string;
  strasse: string | null;
  ort: string | null;
  telefon: string | null;
  mobil: string | null;
  email: string | null;
  liefer_strasse: string | null;
  liefer_ort: string | null;
  firma?: string | null;
  uid?: string | null;
  ist_unternehmer?: boolean;
  reverse_charge?: boolean;
  zahlungsziel_tage?: number | null;
}

export const customerDisplayName = (c: Pick<Customer, "vorname" | "nachname">) =>
  [c.vorname, c.nachname].filter(Boolean).join(" ").trim();

export const customerAddress = (c: Pick<Customer, "strasse" | "ort">) =>
  [c.strasse, c.ort].filter(Boolean).join(", ").trim();

const emptyForm = {
  vorname: "",
  nachname: "",
  strasse: "",
  ort: "",
  telefon: "",
  mobil: "",
  email: "",
  liefer_strasse: "",
  liefer_ort: "",
  // Rechnungsdaten (für Angebote & Rechnungen)
  firma: "",
  uid: "",
  ist_unternehmer: false,
  reverse_charge: false,
  zahlungsziel_tage: "",
};

type CustomerForm = typeof emptyForm;

export const CustomerFormFields = ({
  form,
  setForm,
}: {
  form: CustomerForm;
  setForm: (f: CustomerForm) => void;
}) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="kunde-vorname">Vorname</Label>
        <Input
          id="kunde-vorname"
          value={form.vorname}
          onChange={(e) => setForm({ ...form, vorname: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="kunde-nachname">Nachname *</Label>
        <Input
          id="kunde-nachname"
          value={form.nachname}
          onChange={(e) => setForm({ ...form, nachname: e.target.value })}
        />
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="kunde-strasse">Straße</Label>
        <Input
          id="kunde-strasse"
          value={form.strasse}
          onChange={(e) => setForm({ ...form, strasse: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="kunde-ort">Ort</Label>
        <Input
          id="kunde-ort"
          value={form.ort}
          onChange={(e) => setForm({ ...form, ort: e.target.value })}
        />
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="kunde-telefon">Telefon</Label>
        <Input
          id="kunde-telefon"
          type="tel"
          value={form.telefon}
          onChange={(e) => setForm({ ...form, telefon: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="kunde-mobil">Mobil</Label>
        <Input
          id="kunde-mobil"
          type="tel"
          value={form.mobil}
          onChange={(e) => setForm({ ...form, mobil: e.target.value })}
        />
      </div>
    </div>

    <div className="space-y-1.5">
      <Label htmlFor="kunde-mail">Mail</Label>
      <Input
        id="kunde-mail"
        type="email"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
      />
    </div>

    <div className="rounded-lg border p-3 space-y-3">
      <div className="text-sm font-medium">Rechnungsdaten</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="kunde-firma">Firma (falls Firmenkunde)</Label>
          <Input id="kunde-firma" value={form.firma} onChange={(e) => setForm({ ...form, firma: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kunde-uid">UID (ATU…)</Label>
          <Input id="kunde-uid" value={form.uid} onChange={(e) => setForm({ ...form, uid: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kunde-zz">Zahlungsziel (Tage, leer = Standard)</Label>
          <Input id="kunde-zz" type="number" min={0} value={form.zahlungsziel_tage} onChange={(e) => setForm({ ...form, zahlungsziel_tage: e.target.value })} />
        </div>
        <div className="space-y-2 pt-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={form.ist_unternehmer} onChange={(e) => setForm({ ...form, ist_unternehmer: e.target.checked, reverse_charge: e.target.checked ? form.reverse_charge : false })} />
            Ist Unternehmer (Firma, Hausverwaltung …)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" disabled={!form.ist_unternehmer} checked={form.reverse_charge} onChange={(e) => setForm({ ...form, reverse_charge: e.target.checked })} />
            Reverse Charge bei Bauleistungen (§ 19 Abs. 1a UStG) — UID Pflicht
          </label>
        </div>
      </div>
    </div>

    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Truck className="h-4 w-4 text-primary" />
        Lieferadresse (optional, falls abweichend)
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="kunde-liefer-strasse">Straße</Label>
          <Input
            id="kunde-liefer-strasse"
            value={form.liefer_strasse}
            onChange={(e) => setForm({ ...form, liefer_strasse: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kunde-liefer-ort">Ort</Label>
          <Input
            id="kunde-liefer-ort"
            value={form.liefer_ort}
            onChange={(e) => setForm({ ...form, liefer_ort: e.target.value })}
          />
        </div>
      </div>
    </div>
  </div>
);

export const customerFormToRow = (form: CustomerForm) => ({
  vorname: form.vorname.trim(),
  nachname: form.nachname.trim(),
  strasse: form.strasse.trim() || null,
  ort: form.ort.trim() || null,
  telefon: form.telefon.trim() || null,
  mobil: form.mobil.trim() || null,
  email: form.email.trim() || null,
  liefer_strasse: form.liefer_strasse.trim() || null,
  liefer_ort: form.liefer_ort.trim() || null,
  firma: form.firma.trim() || null,
  uid: form.uid.trim() || null,
  ist_unternehmer: !!form.ist_unternehmer,
  reverse_charge: !!form.ist_unternehmer && !!form.reverse_charge,
  zahlungsziel_tage: form.zahlungsziel_tage === "" ? null : Number(form.zahlungsziel_tage),
});

const Customers = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  // Belege je Kunde (nur Admin): Anzahl, offener Betrag, letztes Datum
  const [belegSummen, setBelegSummen] = useState<Record<string, { belege: number; offen: number; letzter: string | null }>>({});
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id)
        .maybeSingle();
      setIsAdmin(roleData?.role === "administrator");
      await fetchCustomers();
      if (roleData?.role === "administrator" && !isOffline()) {
        const { data } = await supabase.rpc("faktura_kunden_summen");
        const map: Record<string, { belege: number; offen: number; letzter: string | null }> = {};
        (data ?? []).forEach((r) => { if (r.customer_id) map[r.customer_id] = { belege: r.belege, offen: Number(r.offen), letzter: r.letzter }; });
        setBelegSummen(map);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCustomers = async () => {
    setLoading(true);
    // Offline-fähig: ohne Netz kommt sofort der letzte bekannte Stand.
    const { data, error } = await fetchCustomersCached();
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Kunden konnten nicht geladen werden" });
    } else {
      setCustomers((data as unknown as Customer[]) ?? []);
    }
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.kundennr, c.vorname, c.nachname, c.strasse, c.ort, c.telefon, c.mobil, c.email, c.liefer_strasse, c.liefer_ort]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [customers, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({
      vorname: c.vorname ?? "",
      nachname: c.nachname ?? "",
      strasse: c.strasse ?? "",
      ort: c.ort ?? "",
      telefon: c.telefon ?? "",
      mobil: c.mobil ?? "",
      email: c.email ?? "",
      liefer_strasse: c.liefer_strasse ?? "",
      liefer_ort: c.liefer_ort ?? "",
      firma: c.firma ?? "",
      uid: c.uid ?? "",
      ist_unternehmer: !!c.ist_unternehmer,
      reverse_charge: !!c.reverse_charge,
      zahlungsziel_tage: c.zahlungsziel_tage == null ? "" : String(c.zahlungsziel_tage),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.nachname.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte Nachname eingeben" });
      return;
    }

    // Bestehenden Kunden bearbeiten geht nur mit Internet.
    if (editing && isOffline()) {
      toast({
        variant: "destructive",
        title: "Nur mit Internet möglich",
        description: "Bestehende Kunden können nur mit Internetverbindung bearbeitet werden.",
      });
      return;
    }

    setSaving(true);
    const row = customerFormToRow(form);

    if (editing) {
      const { error } = await supabase.from("customers").update(row).eq("id", editing.id);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
      } else {
        toast({ title: "Kunde aktualisiert", description: customerDisplayName(row) });
        setDialogOpen(false);
        await fetchCustomers();
      }
    } else {
      // Neuen Kunden anlegen (offline-fähig, mit clientseitiger id).
      const user = await getSessionUser();
      const newCustomerId = newId();
      const res = await saveInsert(
        "customers",
        { id: newCustomerId, ...row, created_by: user?.id ?? null },
        `Kunde ${customerDisplayName(row)}`
      );
      if (res.error) {
        toast({ variant: "destructive", title: "Fehler", description: res.error });
      } else {
        toast(
          res.queued
            ? { title: "Offline gespeichert", description: "Wird automatisch gesendet, sobald wieder Internet da ist." }
            : { title: "Kunde angelegt", description: customerDisplayName(row) }
        );
        setDialogOpen(false);
        if (res.queued) {
          // Offline: fetchCustomers() liest nur aus Netz/SW-Cache und sieht die noch
          // in der Warteschlange liegende Zeile nicht. Deshalb den neuen Kunden mit
          // seiner Client-id optimistisch ins lokale State einfügen, damit er sofort
          // in der Liste erscheint (endgültige Sortierung folgt beim nächsten Sync).
          const newCustomer: Customer = { id: newCustomerId, ...row };
          setCustomers((prev) => [newCustomer, ...prev]);
        } else {
          await fetchCustomers();
        }
      }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (isOffline()) {
      toast({
        variant: "destructive",
        title: "Nur mit Internet möglich",
        description: "Kunden können nur mit Internetverbindung gelöscht werden.",
      });
      setDeleteTarget(null);
      return;
    }
    const { error } = await supabase.from("customers").delete().eq("id", deleteTarget.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Kunde gelöscht", description: customerDisplayName(deleteTarget) });
      await fetchCustomers();
    }
    setDeleteTarget(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Kundenverwaltung" backPath="/" />

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-6 max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2 flex-wrap">
              <Users className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
              Kunden
              <Badge variant="secondary">{customers.length}</Badge>
            </h2>
            <p className="text-sm text-muted-foreground">Kunden anlegen, bearbeiten und verwalten</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="gap-2 shrink-0">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Neuer Kunde</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editing ? "Kunde bearbeiten" : "Neuen Kunden anlegen"}</DialogTitle>
              </DialogHeader>
              <CustomerFormFields form={form} setForm={setForm} />
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? "Speichern..." : editing ? "Änderungen speichern" : "Kunde anlegen"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Kunden durchsuchen (Name, Ort, Telefon...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <p className="text-center text-muted-foreground py-8">Lade Kunden...</p>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {customers.length === 0
                ? "Noch keine Kunden angelegt. Lege den ersten Kunden an!"
                : "Keine Kunden gefunden."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((c) => (
              <Card key={c.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-semibold text-base flex items-center gap-2 flex-wrap">
                        {/* min-w-0 + break-words: lange Firmennamen brechen um, statt die Seite breiter zu machen */}
                        <span className="min-w-0 break-words">{customerDisplayName(c) || "(ohne Name)"}</span>
                        {/* Kundennummer aus der Faktura-Software (nur wenn vorhanden) */}
                        {c.kundennr && (
                          <span className="text-xs font-normal text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                            Nr. {c.kundennr}
                          </span>
                        )}
                        {c.reverse_charge && (
                          <span className="text-[11px] font-normal text-muted-foreground border rounded px-1.5 py-0.5" title="Übergang der Steuerschuld bei Bauleistungen">RC</span>
                        )}
                      </div>
                      {/* Angebote & Rechnungen dieses Kunden — nur Admin, ein Klick zur gefilterten Belegliste */}
                      {isAdmin && (
                        <button
                          type="button"
                          className="text-sm text-primary underline-offset-2 hover:underline text-left"
                          onClick={(e) => { e.stopPropagation(); navigate(`/belege?kunde=${c.id}${belegSummen[c.id] ? "" : "&neu=1"}`); }}
                        >
                          {belegSummen[c.id]
                            ? `${belegSummen[c.id].belege} Beleg${belegSummen[c.id].belege === 1 ? "" : "e"}${belegSummen[c.id].offen > 0 ? ` · offen ${new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(belegSummen[c.id].offen)}` : ""}`
                            : "Angebot / Rechnung schreiben"}
                        </button>
                      )}
                      {customerAddress(c) && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 break-words">{customerAddress(c)}</span>
                        </div>
                      )}
                      {(c.liefer_strasse || c.liefer_ort) && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Truck className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 break-words">
                            Lieferadresse: {[c.liefer_strasse, c.liefer_ort].filter(Boolean).join(", ")}
                          </span>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground pt-1">
                        {c.telefon && (
                          <a href={`tel:${c.telefon}`} className="flex items-center gap-1.5 hover:text-primary min-w-0 max-w-full py-0.5">
                            <Phone className="h-3.5 w-3.5 shrink-0" />
                            <span className="break-all">{c.telefon}</span>
                          </a>
                        )}
                        {c.mobil && (
                          <a href={`tel:${c.mobil}`} className="flex items-center gap-1.5 hover:text-primary min-w-0 max-w-full py-0.5">
                            <Smartphone className="h-3.5 w-3.5 shrink-0" />
                            <span className="break-all">{c.mobil}</span>
                          </a>
                        )}
                        {c.email && (
                          // break-all: lange Mail-Adressen brechen mitten im Wort um (sonst Seiten-Überlauf)
                          <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 hover:text-primary min-w-0 max-w-full py-0.5">
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            <span className="break-all">{c.email}</span>
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(c)} title="Bearbeiten">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(c)}
                          title="Löschen"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kunde löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `„${customerDisplayName(deleteTarget)}" wird dauerhaft gelöscht. ` : ""}
              Zugeordnete Projekte bleiben bestehen, verlieren aber die Kundenzuordnung.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Customers;
