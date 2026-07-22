import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, Building2, Hammer, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { projectLabel } from "@/lib/projectLabel";
import { getSessionUser } from "@/lib/auth";

type TimeEntry = {
  id: string;
  datum: string;
  taetigkeit: string;
  stunden: number;
  start_time: string | null;
  end_time: string | null;
  pause_minutes: number | null;
  location_type: string;
  notizen: string | null;
  projects: {
    name: string;
    plz: string | null;
    adresse: string | null;
    customers: { strasse: string | null; ort: string | null } | null;
  } | null;
  project_id: string | null;
};

// "HH:MM" (auch "HH:MM:SS") -> Minuten seit Mitternacht
const parseTimeToMinutes = (time: string | null): number | null => {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

// Reale Stundenberechnung aus den tatsächlichen Feldern
const computeHours = (
  start: string | null,
  end: string | null,
  pauseMinutes: number | null,
): number => {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin === null || endMin === null) return 0;
  return Math.max(0, (endMin - startMin - (pauseMinutes || 0)) / 60);
};

const MyHours = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalHours, setTotalHours] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    fetchEntries();
  }, [selectedMonth]);

  const fetchEntries = async () => {
    const user = await getSessionUser();
    if (!user) return;

    const [year, month] = selectedMonth.split('-').map(Number);
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const { data } = await supabase
      .from("time_entries")
      .select("*, projects(name, plz, adresse, customers(strasse, ort))")
      .eq("user_id", user.id)
      .gte("datum", startDate)
      .lte("datum", endDate)
      .order("datum", { ascending: false });

    if (data) {
      setEntries(data as any);
      const sum = data.reduce((acc, entry) => acc + entry.stunden, 0);
      setTotalHours(sum);
    }
    setLoading(false);
  };

  const calculateMorningEnd = (entry: TimeEntry) => {
    // Fallback für alte Einträge ohne Zeitangaben
    if (!entry.start_time || !entry.end_time) {
      return "Alte Buchung";
    }
    if (!entry.pause_minutes || entry.pause_minutes === 0) {
      return entry.end_time?.substring(0, 5) || '-';
    }
    // Mo-Do: 12:00, Fr: 12:00 (keine Pause)
    return "12:00";
  };

  const calculateAfternoonStart = (entry: TimeEntry) => {
    // Fallback für alte Einträge
    if (!entry.start_time || !entry.end_time) return '-';
    if (!entry.pause_minutes || entry.pause_minutes === 0) return '-';
    
    const morningEnd = calculateMorningEnd(entry);
    if (morningEnd === '-' || morningEnd === "Alte Buchung") return '-';
    
    const [hours, minutes] = morningEnd.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + entry.pause_minutes;
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
  };

  const formatPauseTime = (entry: TimeEntry) => {
    // Fallback für alte Einträge
    if (!entry.start_time || !entry.end_time) return '-';
    if (!entry.pause_minutes || entry.pause_minutes === 0) return '-';
    const morningEnd = calculateMorningEnd(entry);
    const afternoonStart = calculateAfternoonStart(entry);
    if (morningEnd === '-' || morningEnd === "Alte Buchung" || afternoonStart === '-') return '-';
    return `${morningEnd} - ${afternoonStart}`;
  };

  const isCurrentMonth = (datum: string) => {
    const entryDate = new Date(datum);
    const [year, month] = selectedMonth.split('-').map(Number);
    return entryDate.getFullYear() === year && entryDate.getMonth() + 1 === month;
  };

  const handleUpdateEntry = async () => {
    if (!editingEntry || savingEdit) return;

    // Zeitausgleich-Einträge sind an das Zeitkonto gekoppelt und dürfen
    // nicht bearbeitet werden (sonst würde das Zeitkonto inkonsistent).
    if (editingEntry.taetigkeit === "Zeitausgleich") {
      toast({
        variant: "destructive",
        title: "Bearbeitung nicht möglich",
        description: "Zeitausgleich-Einträge können nicht bearbeitet werden — bitte löschen und neu anlegen",
      });
      return;
    }

    setSavingEdit(true);

    // Abwesenheiten (Urlaub, Krankenstand, Weiterbildung, Feiertag,
    // Zeitausgleich) haben ggf. einen individuellen/Norm-Stundenwert
    // (z.B. Freitag 4,5 h), der NICHT aus der 07:00–16:00-Spanne neu berechnet
    // werden darf. Für solche Einträge nur Tätigkeit/Notizen speichern und die
    // gespeicherten Stunden unverändert lassen. Reguläre Arbeitseinträge werden
    // wie gehabt aus Beginn/Ende/Pause neu berechnet.
    const ABSENCE_TAETIGKEITEN = ["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag", "Zeitausgleich"];
    const isAbsence = ABSENCE_TAETIGKEITEN.includes(editingEntry.taetigkeit);

    // Reale Stundenberechnung aus Beginn, Ende und Pause (nur Arbeitseinträge)
    const calculatedHours = computeHours(
      editingEntry.start_time,
      editingEntry.end_time,
      editingEntry.pause_minutes,
    );

    const updatePayload = isAbsence
      ? {
          taetigkeit: editingEntry.taetigkeit,
          notizen: editingEntry.notizen?.trim() || null,
        }
      : {
          taetigkeit: editingEntry.taetigkeit,
          start_time: editingEntry.start_time,
          end_time: editingEntry.end_time,
          pause_minutes: editingEntry.pause_minutes || 0,
          notizen: editingEntry.notizen?.trim() || null,
          stunden: calculatedHours,
        };

    const { error } = await supabase
      .from("time_entries")
      .update(updatePayload)
      .eq("id", editingEntry.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Eintrag konnte nicht aktualisiert werden",
      });
    } else {
      toast({
        title: "Erfolg",
        description: "Eintrag wurde aktualisiert",
      });
      setShowEditDialog(false);
      setEditingEntry(null);
      fetchEntries();
    }
    setSavingEdit(false);
  };

  const handleDeleteEntry = async (entry: TimeEntry) => {
    if (!confirm("Möchtest du diesen Eintrag wirklich löschen?")) return;

    // Zeitausgleich: Stunden zurück auf das Zeitkonto buchen, bevor gelöscht wird
    if (entry.taetigkeit === "Zeitausgleich" && entry.stunden > 0) {
      const user = await getSessionUser();
      if (!user) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Nicht angemeldet. Eintrag wurde nicht gelöscht.",
        });
        return;
      }

      const { data: timeAccount, error: taError } = await supabase
        .from("time_accounts")
        .select("id, balance_hours")
        .eq("user_id", user.id)
        .maybeSingle();

      if (taError || !timeAccount) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Zeitkonto konnte nicht gefunden werden. Eintrag wurde nicht gelöscht.",
        });
        return;
      }

      const balanceBefore = Number(timeAccount.balance_hours);
      const balanceAfter = balanceBefore + entry.stunden;

      const { error: updateErr } = await supabase
        .from("time_accounts")
        .update({ balance_hours: balanceAfter, updated_at: new Date().toISOString() })
        .eq("id", timeAccount.id);

      if (updateErr) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "ZA-Stunden konnten nicht zurückgebucht werden. Eintrag wurde nicht gelöscht.",
        });
        return;
      }

      await supabase.from("time_account_transactions").insert({
        user_id: user.id,
        changed_by: user.id,
        change_type: "za_rueckerstattung",
        hours: entry.stunden,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reason: `Zeitausgleich-Eintrag gelöscht am ${entry.datum}`,
      });
    }

    const { error } = await supabase
      .from("time_entries")
      .delete()
      .eq("id", entry.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Eintrag konnte nicht gelöscht werden",
      });
    } else {
      toast({
        title: "Erfolg",
        description: "Eintrag wurde gelöscht",
      });
      setShowEditDialog(false);
      setEditingEntry(null);
      fetchEntries();
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><p>Lädt...</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4 mr-2" />Zurück
            </Button>
            <img 
              src="/ruff-logo.png"
              alt="Ruff Michael Logo"
              className="h-8 w-8 sm:h-10 sm:w-10 cursor-pointer hover:opacity-80 transition-opacity object-contain" 
              onClick={() => navigate("/")}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-7xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Meine Stunden
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-4 border-b">
              <div className="flex items-center gap-2">
                <Label htmlFor="month-select" className="text-sm font-medium">Monat:</Label>
                <Input
                  id="month-select"
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="text-sm sm:text-base">
                <span className="text-muted-foreground">Gesamt: </span>
                <span className="font-bold text-lg text-primary">{totalHours.toFixed(2)} Std.</span>
              </div>
            </div>

            {entries.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Keine Einträge für {new Date(selectedMonth + '-01').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Datum</TableHead>
                      <TableHead>Ort</TableHead>
                      <TableHead>Projekt</TableHead>
                      <TableHead>Tätigkeit</TableHead>
                      <TableHead colSpan={2} className="text-center">Vormittag</TableHead>
                      <TableHead className="text-center">Pause</TableHead>
                      <TableHead colSpan={2} className="text-center">Nachmittag</TableHead>
                      <TableHead className="text-right">Stunden</TableHead>
                      <TableHead className="text-right">Aktionen</TableHead>
                    </TableRow>
                    <TableRow>
                      <TableHead></TableHead>
                      <TableHead></TableHead>
                      <TableHead></TableHead>
                      <TableHead></TableHead>
                      <TableHead className="text-center">Beginn</TableHead>
                      <TableHead className="text-center">Ende</TableHead>
                      <TableHead className="text-center">von - bis</TableHead>
                      <TableHead className="text-center">Beginn</TableHead>
                      <TableHead className="text-center">Ende</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {new Date(entry.datum).toLocaleDateString("de-DE")}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            {entry.location_type === 'werkstatt' ? (
                              <>
                                <Hammer className="w-4 h-4 text-muted-foreground" />
                                <span>Werkstatt</span>
                              </>
                            ) : (
                              <>
                                <Building2 className="w-4 h-4 text-muted-foreground" />
                                <span>Baustelle</span>
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{entry.projects ? projectLabel(entry.projects) : '-'}</TableCell>
                        <TableCell>
                          <div>{entry.taetigkeit}</div>
                          {entry.notizen && (
                            <div className="text-xs text-muted-foreground">{entry.notizen}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {entry.start_time?.substring(0, 5) || '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          {calculateMorningEnd(entry)}
                        </TableCell>
                        <TableCell className="text-center">
                          {formatPauseTime(entry)}
                        </TableCell>
                        <TableCell className="text-center">
                          {calculateAfternoonStart(entry)}
                        </TableCell>
                        <TableCell className="text-center">
                          {entry.pause_minutes && entry.pause_minutes > 0 
                            ? entry.end_time?.substring(0, 5) || '-'
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {entry.stunden.toFixed(2)} h
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingEntry(entry);
                              setShowEditDialog(true);
                            }}
                            disabled={!isCurrentMonth(entry.datum)}
                            className="h-8"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={10} className="text-right font-semibold">
                        Gesamtstunden:
                      </TableCell>
                      <TableCell className="text-right font-bold text-lg">
                        {totalHours.toFixed(2)} h
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={(open) => {
        setShowEditDialog(open);
        if (!open) setEditingEntry(null);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Stundeneintrag bearbeiten</DialogTitle>
            <DialogDescription>
              {editingEntry && (
                <>
                  Datum: {new Date(editingEntry.datum).toLocaleDateString('de-DE', { 
                    weekday: 'long', 
                    day: '2-digit', 
                    month: 'long', 
                    year: 'numeric' 
                  })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {editingEntry && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-taetigkeit">Tätigkeit</Label>
                <Input
                  id="edit-taetigkeit"
                  value={editingEntry.taetigkeit}
                  onChange={(e) => setEditingEntry({...editingEntry, taetigkeit: e.target.value})}
                  placeholder="z.B. Dachstuhl montieren"
                />
              </div>

              {/* Arbeitszeit */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <h3 className="font-semibold text-sm">Arbeitszeit</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="edit-start">Beginn</Label>
                    <Input
                      id="edit-start"
                      type="time"
                      value={editingEntry.start_time?.substring(0, 5) || ''}
                      onChange={(e) => setEditingEntry({...editingEntry, start_time: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-end">Ende</Label>
                    <Input
                      id="edit-end"
                      type="time"
                      value={editingEntry.end_time?.substring(0, 5) || ''}
                      onChange={(e) => setEditingEntry({...editingEntry, end_time: e.target.value})}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="edit-pause">Pause (Minuten)</Label>
                    <Input
                      id="edit-pause"
                      type="number"
                      min="0"
                      value={editingEntry.pause_minutes ?? 0}
                      onChange={(e) => setEditingEntry({...editingEntry, pause_minutes: parseInt(e.target.value) || 0})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-stunden">Stunden (berechnet)</Label>
                    <Input
                      id="edit-stunden"
                      value={`${computeHours(editingEntry.start_time, editingEntry.end_time, editingEntry.pause_minutes).toFixed(2)} h`}
                      readOnly
                      disabled
                      className="bg-muted"
                    />
                  </div>
                </div>
              </div>

              {editingEntry.taetigkeit === "Zeitausgleich" && (
                <p className="text-xs text-destructive">
                  Zeitausgleich-Einträge können nicht bearbeitet werden — bitte löschen und neu anlegen.
                </p>
              )}

              {/* Notizen */}
              <div>
                <Label htmlFor="edit-notizen">Notizen</Label>
                <Textarea
                  id="edit-notizen"
                  value={editingEntry.notizen || ''}
                  onChange={(e) => setEditingEntry({...editingEntry, notizen: e.target.value})}
                  placeholder="Zusätzliche Bemerkungen..."
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleUpdateEntry} className="flex-1" disabled={savingEdit}>
                  {savingEdit ? 'Wird gespeichert...' : 'Speichern'}
                </Button>
                <Button 
                  variant="destructive"
                  onClick={() => editingEntry && handleDeleteEntry(editingEntry)}
                  className="flex-1"
                  disabled={savingEdit}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Löschen
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyHours;
