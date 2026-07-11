import { ArrowLeft, BarChart3, Download, Check, ChevronsUpDown, FolderOpen, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { QuickUploadDialog } from "@/components/QuickUploadDialog";
import { ProjectFilesManager } from "@/components/ProjectFilesManager";
import { PageHeader } from "@/components/PageHeader";

type Project = {
  id: string;
  name: string;
};

type TimeEntry = {
  id: string;
  datum: string;
  taetigkeit: string;
  stunden: number;
  notizen: string | null;
  profiles: {
    vorname: string;
    nachname: string;
  } | null;
  projects: {
    name: string;
  } | null;
};

type StorageFile = {
  name: string;
  id: string;
  created_at: string;
};

const Reports = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalHours, setTotalHours] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [projectPhotos, setProjectPhotos] = useState<StorageFile[]>([]);
  const [showQuickUpload, setShowQuickUpload] = useState(false);
  const [showFilesManager, setShowFilesManager] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    fetchTimeEntries();
    if (selectedProject && selectedProject !== "all") {
      fetchProjectPhotos(selectedProject);
    } else {
      setProjectPhotos([]);
    }
  }, [selectedProject]);

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name')
      .eq('status', 'aktiv')
      .order('name');

    if (error) {
      console.error('Error fetching projects:', error);
      toast.error('Fehler beim Laden der Projekte');
      return;
    }

    setProjects(data || []);
  };

  const fetchTimeEntries = async () => {
    setLoading(true);
    
    let query = supabase
      .from('time_entries')
      .select(`
        id,
        datum,
        taetigkeit,
        stunden,
        notizen,
        user_id,
        projects!inner(name)
      `)
      .order('datum', { ascending: false });

    if (selectedProject !== "all") {
      query = query.eq('project_id', selectedProject);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching time entries:', error);
      toast.error('Fehler beim Laden der Zeiteinträge');
      setLoading(false);
      return;
    }

    const entriesWithProfiles = await Promise.all(
      (data || []).map(async (entry) => {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('vorname, nachname')
          .eq('id', entry.user_id)
          .single();

        return {
          ...entry,
          profiles: profileData,
        };
      })
    );

    setTimeEntries(entriesWithProfiles as any);
    
    const total = (data || []).reduce((sum, entry) => sum + Number(entry.stunden), 0);
    setTotalHours(total);
    
    setLoading(false);
  };

  const fetchProjectPhotos = async (projectId: string) => {
    const { data, error } = await supabase.storage
      .from('project-photos')
      .list(projectId, { 
        limit: 4,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) {
      console.error('Error fetching photos:', error);
      return;
    }

    setProjectPhotos(data || []);
  };

  const getPhotoUrl = (projectId: string, fileName: string) => {
    const { data } = supabase.storage
      .from('project-photos')
      .getPublicUrl(`${projectId}/${fileName}`);
    return data.publicUrl;
  };

  const exportToPDF = async () => {
    setExporting(true);
    
    try {
      const projectName = selectedProject === "all" 
        ? "Alle Projekte" 
        : projects.find(p => p.id === selectedProject)?.name || "Unbekanntes Projekt";
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Stundenauswertung - ${projectName}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { color: #333; border-bottom: 2px solid #666; padding-bottom: 10px; }
            .summary { background: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 5px; }
            .summary h2 { margin: 0 0 10px 0; font-size: 18px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background: #333; color: white; padding: 12px; text-align: left; }
            td { padding: 10px; border-bottom: 1px solid #ddd; }
            tr:hover { background: #f9f9f9; }
            .total { font-weight: bold; font-size: 18px; color: #2563eb; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>Stundenauswertung - ${projectName}</h1>
          <div class="summary">
            <h2>Zusammenfassung</h2>
            <p><strong>Projekt:</strong> ${projectName}</p>
            <p><strong>Anzahl Einträge:</strong> ${timeEntries.length}</p>
            <p><strong>Gesamtstunden:</strong> <span class="total">${totalHours.toFixed(2)} h</span></p>
            <p><strong>Erstellt am:</strong> ${new Date().toLocaleDateString('de-DE', { 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}</p>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Mitarbeiter</th>
                <th>Projekt</th>
                <th>Tätigkeit</th>
                <th>Stunden</th>
                <th>Notizen</th>
              </tr>
            </thead>
            <tbody>
              ${timeEntries.map(entry => `
                <tr>
                  <td>${new Date(entry.datum).toLocaleDateString('de-DE')}</td>
                  <td>${entry.profiles ? `${entry.profiles.vorname} ${entry.profiles.nachname}` : 'Unbekannt'}</td>
                  <td>${entry.projects?.name || 'Unbekanntes Projekt'}</td>
                  <td>${entry.taetigkeit}</td>
                  <td><strong>${entry.stunden} h</strong></td>
                  <td>${entry.notizen || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <div class="footer">
            <p>Ruff Michael GmbH - Stundenauswertung</p>
          </div>
        </body>
        </html>
      `;

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.focus();
        
        printWindow.onload = () => {
          printWindow.print();
        };
        
        toast.success('PDF-Export vorbereitet');
      } else {
        toast.error('Pop-up blockiert. Bitte erlauben Sie Pop-ups für diese Seite.');
      }
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error('Fehler beim Exportieren');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Projektberichte & Dateien" />
      
      <main className="container mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <BarChart3 className="w-8 h-8" />
            Projektberichte & Dateien
          </h1>
          <p className="text-muted-foreground">Arbeitszeiten und Dokumente nach Projekt</p>
        </div>

        <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">Hinweis</h3>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Suchen Sie die <strong>Stundenauswertung</strong> nach Mitarbeitern?{" "}
                <Button 
                  variant="link" 
                  className="p-0 h-auto text-blue-600 dark:text-blue-400 font-semibold underline" 
                  onClick={() => navigate("/hours-report")}
                >
                  Hier klicken →
                </Button>
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6 flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label className="text-sm font-medium mb-2 block">Projekt auswählen</label>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  className="w-full justify-between"
                >
                  {selectedProject === "all"
                    ? "Alle Projekte"
                    : projects.find((project) => project.id === selectedProject)?.name || "Projekt auswählen"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput placeholder="Projekt suchen..." />
                  <CommandList>
                    <CommandEmpty>Kein Projekt gefunden.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="all"
                        onSelect={() => {
                          setSelectedProject("all");
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedProject === "all" ? "opacity-100" : "opacity-0"
                          )}
                        />
                        Alle Projekte
                      </CommandItem>
                      {projects.map((project) => (
                        <CommandItem
                          key={project.id}
                          value={project.name}
                          onSelect={() => {
                            setSelectedProject(project.id);
                            setOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedProject === project.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {project.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          
          <Button
            onClick={exportToPDF}
            disabled={exporting || timeEntries.length === 0}
            className="gap-2"
            variant="outline"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exportiert...' : 'Als PDF exportieren'}
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-2xl">
              Gesamtstunden: <span className="text-primary">{totalHours.toFixed(2)}h</span>
            </CardTitle>
          </CardHeader>
        </Card>

        {/* Projektdateien Sektion - nur wenn Projekt ausgewählt */}
        {selectedProject && selectedProject !== "all" && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl flex items-center gap-2">
                  <FolderOpen className="w-5 h-5" />
                  Projektdateien
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFilesManager(true)}
                  >
                    Alle Dateien anzeigen
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setShowQuickUpload(true)}
                    className="gap-2"
                  >
                    <ImagePlus className="w-4 h-4" />
                    Foto hochladen
                  </Button>
                </div>
              </div>
            </CardHeader>
            {projectPhotos.length > 0 && (
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {projectPhotos.map((photo) => (
                    <div 
                      key={photo.id}
                      className="aspect-square rounded-lg overflow-hidden border cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => navigate(`/projects/${selectedProject}/photos`)}
                    >
                      <img
                        src={getPhotoUrl(selectedProject, photo.name)}
                        alt={photo.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Lädt...</p>
          </div>
        ) : timeEntries.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Keine Zeiteinträge gefunden</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {timeEntries.map((entry) => (
              <Card key={entry.id}>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Datum</p>
                      <p className="font-semibold">
                        {new Date(entry.datum).toLocaleDateString('de-DE')}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Mitarbeiter</p>
                      <p className="font-semibold">
                        {entry.profiles ? `${entry.profiles.vorname} ${entry.profiles.nachname}` : 'Unbekannt'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Projekt</p>
                      <p className="font-semibold">{entry.projects?.name || 'Unbekanntes Projekt'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Stunden</p>
                      <p className="font-semibold text-primary text-lg">{entry.stunden}h</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <p className="text-sm font-medium text-muted-foreground">Tätigkeit</p>
                    <p className="mt-1">{entry.taetigkeit}</p>
                  </div>
                  {entry.notizen && (
                    <div className="mt-3">
                      <p className="text-sm font-medium text-muted-foreground">Notizen</p>
                      <p className="mt-1 text-sm">{entry.notizen}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Quick Upload Dialog */}
      {selectedProject && selectedProject !== "all" && (
        <QuickUploadDialog
          projectId={selectedProject}
          documentType="photos"
          open={showQuickUpload}
          onClose={() => setShowQuickUpload(false)}
          onSuccess={() => fetchProjectPhotos(selectedProject)}
        />
      )}

      {/* Project Files Manager Dialog */}
      {selectedProject && selectedProject !== "all" && (
        <Dialog open={showFilesManager} onOpenChange={setShowFilesManager}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>Projektdateien verwalten</DialogTitle>
              <DialogDescription>
                Alle Dateien für {projects.find(p => p.id === selectedProject)?.name}
              </DialogDescription>
            </DialogHeader>
            <ProjectFilesManager 
              projectId={selectedProject}
              defaultTab="photos"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default Reports;
