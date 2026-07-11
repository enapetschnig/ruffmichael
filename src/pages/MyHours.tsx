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
    const { data: { user } } = await supabase.auth.getUser();
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

    setSavingEdit(true);

    // Berechne Stunden basierend auf Vormittag und Nachmittag
    const morningStart = editingEntry.start_time ? new Date(`2000-01-01T${editingEntry.start_time}`) : null;
    // Morning End: immer 12:00
    const morningEndTime = "12:00";
    const morningEnd = new Date(`2000-01-01T${morningEndTime}`);
    
    let calculatedHours = 0;
    
    if (morningStart) {
      // Vormittagsstunden
      const morningMs = morningEnd.getTime() - morningStart.getTime();
      const morningMinutes = morningMs / (1000 * 60);
      calculatedHours += morningMinutes / 60;
      
      // Nachmittagsstunden (wenn vorhanden)
      if (editingEntry.end_time) {
        const afternoonEnd = new Date(`2000-01-01T${editingEntry.end_time}`);
        const pauseMinutes = editingEntry.pause_minutes || 0;
        const afternoonStartTime = new Date(morningEnd.getTime() + pauseMinutes * 60 * 1000);
        const afternoonMs = afternoonEnd.getTime() - afternoonStartTime.getTime();
        const afternoonMinutes = Math.max(0, afternoonMs / (1000 * 60));
        calculatedHours += afternoonMinutes / 60;
      }
    }

    const { error } = await supabase
      .from("time_entries")
      .update({
        taetigkeit: editingEntry.taetigkeit,
        start_time: editingEntry.start_time,
        end_time: editingEntry.end_time,
        pause_minutes: editingEntry.pause_minutes || 0,
        notizen: editingEntry.notizen?.trim() || null,
        stunden: Math.max(0, calculatedHours),
      })
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

  const handleDeleteEntry = async (id: string) => {
    if (!confirm("Möchtest du diesen Eintrag wirklich löschen?")) return;

    const { error } = await supabase
      .from("time_entries")
      .delete()
      .eq("id", id);

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

              {/* Vormittag */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <h3 className="font-semibold text-sm">Vormittag</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="edit-morning-start">Beginn</Label>
                    <Input
                      id="edit-morning-start"
                      type="time"
                      value={editingEntry.start_time || '07:30'}
                      onChange={(e) => setEditingEntry({...editingEntry, start_time: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-morning-end">Ende</Label>
                    <Input
                      id="edit-morning-end"
                      type="time"
                      value="12:00"
                      disabled
                      className="bg-muted"
                    />
                  </div>
                </div>
              </div>

              {/* Unterbrechung */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <h3 className="font-semibold text-sm">Unterbrechung</h3>
                <div>
                  <Label htmlFor="edit-pause">Dauer (Minuten)</Label>
                  <Input
                    id="edit-pause"
                    type="number"
                    min="0"
                    value={editingEntry.pause_minutes || 0}
                    onChange={(e) => setEditingEntry({...editingEntry, pause_minutes: parseInt(e.target.value) || 0})}
                  />
                </div>
              </div>

              {/* Nachmittag */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <h3 className="font-semibold text-sm">Nachmittag</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="edit-afternoon-start">Beginn</Label>
                    <Input
                      id="edit-afternoon-start"
                      type="time"
                      value={(() => {
                        const dayOfWeek = new Date(editingEntry.datum).getDay();
                        const isFriday = dayOfWeek === 5;
                        const morningEnd = isFriday ? "12:30" : "12:00";
                        const [hours, minutes] = morningEnd.split(':').map(Number);
                        const pauseMinutes = editingEntry.pause_minutes || 0;
                        const totalMinutes = hours * 60 + minutes + pauseMinutes;
                        return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
                      })()}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-afternoon-end">Ende</Label>
                    <Input
                      id="edit-afternoon-end"
                      type="time"
                      value={editingEntry.end_time || ''}
                      onChange={(e) => setEditingEntry({...editingEntry, end_time: e.target.value})}
                    />
                  </div>
                </div>
                {new Date(editingEntry.datum).getDay() === 5 && (
                  <p className="text-xs text-muted-foreground">
                    Freitags ist die Normalarbeitszeit 7:30-12:30 Uhr. Nachmittag nur bei Überstunden.
                  </p>
                )}
              </div>

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
                  onClick={() => editingEntry && handleDeleteEntry(editingEntry.id)}
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
