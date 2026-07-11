import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Download, Calendar, Briefcase, MapPin, Wrench } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";

interface DetailedProjectEntry {
  id: string;
  userId: string;
  employeeName: string;
  datum: string;
  startTime: string;
  endTime: string;
  pauseStart: string | null;
  pauseEnd: string | null;
  pauseMinutes: number;
  taetigkeit: string;
  hours: number;
  locationType: string;
}

interface Project {
  id: string;
  name: string;
  plz?: string;
}

export default function ProjectHoursReport() {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectData, setProjectData] = useState<DetailedProjectEntry[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Record<string, { vorname: string; nachname: string }>>({});
  const [startDate, setStartDate] = useState<string>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const { toast } = useToast();

  useEffect(() => {
    fetchProfiles();
    fetchProjects();
  }, []);

  const fetchProfiles = async () => {
    const { data } = await supabase.from("profiles").select("id, vorname, nachname");
    if (data) {
      const profileMap: Record<string, { vorname: string; nachname: string }> = {};
      data.forEach((profile) => {
        profileMap[profile.id] = { vorname: profile.vorname, nachname: profile.nachname };
      });
      setProfiles(profileMap);
    }
  };

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectHours();
    }
  }, [selectedProjectId, startDate, endDate]);

  useEffect(() => {
    if (!selectedProjectId) return;
    
    const channel = supabase
      .channel('project-hours-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'time_entries',
        filter: `project_id=eq.${selectedProjectId}`
      }, () => {
        console.log('Projektstunden aktualisiert - neu laden');
        fetchProjectHours();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedProjectId]);

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, plz")
      .order("name");

    if (data && !error) {
      setProjects(data);
      if (data.length > 0) {
        setSelectedProjectId(data[0].id);
      }
    }
    setLoading(false);
  };

  const fetchProjectHours = async () => {
    if (!selectedProjectId) return;

    setLoading(true);

    const { data, error } = await supabase
      .from("time_entries")
      .select("id, datum, start_time, end_time, pause_start, pause_end, pause_minutes, stunden, taetigkeit, user_id, location_type")
      .eq("project_id", selectedProjectId)
      .gte("datum", startDate)
      .lte("datum", endDate)
      .not("project_id", "is", null)
      .order("datum", { ascending: true });

    if (error) {
      console.error("Fehler beim Laden der Projektstunden:", error);
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Projektstunden konnten nicht geladen werden"
      });
      setLoading(false);
      return;
    }

    console.log(`Projektstunden geladen: ${data?.length || 0} Einträge gefunden`);
    if (data) {
      const detailedEntries: DetailedProjectEntry[] = [];
      let total = 0;

      data.forEach((entry: any) => {
        total += entry.stunden;

        const profile = profiles[entry.user_id];
        if (!profile) {
          console.warn(`Profil nicht gefunden für user_id: ${entry.user_id}`);
          return;
        }

        detailedEntries.push({
          id: entry.id,
          userId: entry.user_id,
          employeeName: `${profile.vorname} ${profile.nachname}`,
          datum: entry.datum,
          startTime: entry.start_time,
          endTime: entry.end_time,
          pauseStart: entry.pause_start,
          pauseEnd: entry.pause_end,
          pauseMinutes: entry.pause_minutes || 0,
          taetigkeit: entry.taetigkeit,
          hours: entry.stunden,
          locationType: entry.location_type || "baustelle",
        });
      });

      // Sort by date, then by employee name
      detailedEntries.sort((a, b) => {
        const dateCompare = a.datum.localeCompare(b.datum);
        if (dateCompare !== 0) return dateCompare;
        return a.employeeName.localeCompare(b.employeeName);
      });

      setProjectData(detailedEntries);
      setTotalHours(total);
    }

    setLoading(false);
  };

  const formatTime = (time: string | null): string => {
    if (!time) return "";
    return time.substring(0, 5);
  };

  const formatPause = (entry: DetailedProjectEntry): string => {
    if (entry.pauseStart && entry.pauseEnd) {
      return `${formatTime(entry.pauseStart)} - ${formatTime(entry.pauseEnd)}`;
    }
    if (entry.pauseMinutes > 0) {
      return `${entry.pauseMinutes} Min.`;
    }
    return "";
  };

  const addBordersToCell = (cell: any, thick: boolean = false) => {
    const borderStyle = thick ? "medium" : "thin";
    cell.s = {
      border: {
        top: { style: borderStyle, color: { rgb: "000000" } },
        bottom: { style: borderStyle, color: { rgb: "000000" } },
        left: { style: borderStyle, color: { rgb: "000000" } },
        right: { style: borderStyle, color: { rgb: "000000" } },
      },
      alignment: { vertical: "center", horizontal: "left" },
    };
  };

  const exportToExcel = () => {
    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    if (!selectedProject) return;

    const worksheetData: any[][] = [
      ["Projektzeiterfassung", selectedProject.name],
      ["PLZ:", selectedProject.plz || "k.A."],
      ["Zeitraum:", `${startDate} bis ${endDate}`],
      [],
      ["Datum", "Start", "Ende", "Pause", "Stunden", "Mitarbeiter", "Tätigkeit", "Ort"],
    ];

    projectData.forEach((entry) => {
      const dateFormatted = format(parseISO(entry.datum), "dd.MM.yyyy", { locale: de });
      const ortText = entry.locationType === "werkstatt" ? "Werkstatt" : "Baustelle";
      
      worksheetData.push([
        dateFormatted,
        formatTime(entry.startTime),
        formatTime(entry.endTime),
        formatPause(entry),
        entry.hours.toFixed(2),
        entry.employeeName,
        entry.taetigkeit,
        ortText,
      ]);
    });

    worksheetData.push([]);
    worksheetData.push(["GESAMT", "", "", "", totalHours.toFixed(2), "", "", ""]);

    const ws = XLSX.utils.aoa_to_sheet(worksheetData);
    
    ws["!cols"] = [
      { wch: 12 },  // Datum
      { wch: 8 },   // Start
      { wch: 8 },   // Ende
      { wch: 14 },  // Pause
      { wch: 10 },  // Stunden
      { wch: 22 },  // Mitarbeiter
      { wch: 20 },  // Tätigkeit
      { wch: 12 },  // Ort
    ];

    ws["!merges"] = [
      { s: { r: 0, c: 1 }, e: { r: 0, c: 7 } },
      { s: { r: 2, c: 1 }, e: { r: 2, c: 7 } },
    ];

    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) {
          ws[cellAddress] = { t: "s", v: "" };
        }
        
        const isHeader = R === 4;
        addBordersToCell(ws[cellAddress], isHeader);
        
        if (isHeader || R === worksheetData.length - 1) {
          ws[cellAddress].s = {
            ...ws[cellAddress].s,
            font: { bold: true },
          };
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, selectedProject.name.substring(0, 31));
    XLSX.writeFile(wb, `Projektzeiterfassung_${selectedProject.name}.xlsx`);

    toast({
      title: "Export erfolgreich",
      description: "Die Excel-Datei wurde heruntergeladen",
    });
  };

  if (loading && projects.length === 0) {
    return <div className="text-center py-8">Lädt Projekte...</div>;
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>Projektzeiterfassung</CardTitle>
            <CardDescription>
              Detaillierte Stunden nach Projekt mit Arbeitszeiten
            </CardDescription>
          </div>
          <Button 
            onClick={exportToExcel} 
            disabled={!selectedProjectId || projectData.length === 0}
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            Excel exportieren
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Projekt auswählen</label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Projekt wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name} {project.plz && `(${project.plz})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Von:</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Bis:</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const now = new Date();
                  setStartDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]);
                  setEndDate(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]);
                }}
              >
                Dieser Monat
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const now = new Date();
                  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                  setStartDate(lastMonth.toISOString().split('T')[0]);
                  setEndDate(new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]);
                }}
              >
                Letzter Monat
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const now = new Date();
                  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 3, 1);
                  const quarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 0);
                  setStartDate(quarterStart.toISOString().split('T')[0]);
                  setEndDate(quarterEnd.toISOString().split('T')[0]);
                }}
              >
                Letztes Quartal
              </Button>
            </div>
          </CardContent>
        </Card>

        {selectedProject && (
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Projekt</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{selectedProject.name}</p>
                <p className="text-sm text-muted-foreground">
                  PLZ: {selectedProject.plz || "k.A."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Gesamt-Stunden</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{totalHours.toFixed(2)}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {projectData.length > 0 ? (
          <Card>
            <CardContent className="pt-6 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>Ende</TableHead>
                    <TableHead>Pause</TableHead>
                    <TableHead className="text-right">Stunden</TableHead>
                    <TableHead>Mitarbeiter</TableHead>
                    <TableHead>Tätigkeit</TableHead>
                    <TableHead>Ort</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectData.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">
                        {format(parseISO(entry.datum), "dd.MM.yyyy", { locale: de })}
                      </TableCell>
                      <TableCell>{formatTime(entry.startTime)}</TableCell>
                      <TableCell>{formatTime(entry.endTime)}</TableCell>
                      <TableCell>{formatPause(entry)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {entry.hours.toFixed(2)}
                      </TableCell>
                      <TableCell>{entry.employeeName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          <Briefcase className="w-3 h-3" />
                          {entry.taetigkeit}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entry.locationType === "werkstatt" ? (
                          <Badge variant="secondary" className="gap-1">
                            <Wrench className="w-3 h-3" />
                            Werkstatt
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <MapPin className="w-3 h-3" />
                            Baustelle
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4} className="font-bold">Gesamt</TableCell>
                    <TableCell className="text-right font-bold">
                      {totalHours.toFixed(2)}
                    </TableCell>
                    <TableCell colSpan={3}></TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        ) : selectedProjectId ? (
          <div className="text-center py-12 text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Keine Stunden für dieses Projekt erfasst</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
