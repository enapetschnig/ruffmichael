import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Download, Trash2, Camera, FileText, Package, Lock, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { useToast } from "@/hooks/use-toast";

type DocumentType = 'photos' | 'plans' | 'reports' | 'materials' | 'chef' | 'notizen';

interface Document {
  id: string;
  name: string;
  typ: string;
  file_url: string;
  created_at: string;
  beschreibung: string | null;
}

interface ProjectFilesManagerProps {
  projectId: string;
  defaultTab?: DocumentType;
}

const bucketMap: Record<DocumentType, string> = {
  photos: 'project-photos',
  plans: 'project-plans',
  reports: 'project-reports',
  materials: 'project-materials',
  chef: 'project-chef',
  notizen: 'project-notizen',
};

const titleMap: Record<DocumentType, string> = {
  photos: '📷 Fotos',
  plans: '📋 Pläne',
  reports: '📄 Berichte',
  materials: '📦 Material',
  chef: '🔒 Chefordner',
  notizen: '📝 Notizen',
};

const iconMap: Record<DocumentType, React.ReactNode> = {
  photos: <Camera className="w-4 h-4" />,
  plans: <FileText className="w-4 h-4" />,
  reports: <FileText className="w-4 h-4" />,
  materials: <Package className="w-4 h-4" />,
  chef: <Lock className="w-4 h-4" />,
  notizen: <ClipboardList className="w-4 h-4" />,
};

export function ProjectFilesManager({ projectId, defaultTab = 'photos' }: ProjectFilesManagerProps) {
  const { toast: reactToast } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<DocumentType | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAdminStatus();
    fetchDocuments();
  }, [projectId]);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "administrator")
      .maybeSingle();

    setIsAdmin(!!data);
  };

  const fetchDocuments = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching documents:', error);
      toast.error('Fehler beim Laden der Dateien');
    } else {
      setDocuments(data || []);
    }
    setLoading(false);
  };

  const handleUpload = async (type: DocumentType, files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Größenprüfung: 50 MB = 52.428.800 Bytes
    const MAX_SIZE = 50 * 1024 * 1024;
    const oversizedFiles: string[] = [];

    Array.from(files).forEach((file) => {
      if (file.size > MAX_SIZE) {
        oversizedFiles.push(`${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      }
    });

    if (oversizedFiles.length > 0) {
      reactToast({
        variant: "destructive",
        title: "Dateien zu groß",
        description: `Folgende Dateien sind zu groß (max. 50 MB): ${oversizedFiles.join(", ")}`,
      });
      return;
    }

    setUploading(type);
    const bucketName = bucketMap[type];

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Nicht authentifiziert');

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${i}.${fileExt}`;
        const filePath = `${projectId}/${fileName}`;

        // Upload zu Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Public URL holen
        const { data: urlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        // Dokument in DB eintragen
        const { error: dbError } = await supabase
          .from('documents')
          .insert({
            project_id: projectId,
            user_id: user.id,
            typ: type,
            name: file.name,
            file_url: urlData.publicUrl,
          });

        if (dbError) throw dbError;
      }

      toast.success(`${files.length} Datei(en) hochgeladen`);
      fetchDocuments();
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Fehler beim Hochladen');
    } finally {
      setUploading(null);
    }
  };

  const downloadFile = async (fileUrl: string, fileName: string) => {
    try {
      const response = await fetch(fileUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Download gestartet');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Fehler beim Download');
    }
  };

  const deleteFile = async (docId: string, fileUrl: string, type: DocumentType) => {
    if (!isAdmin) {
      toast.error('Keine Berechtigung zum Löschen');
      return;
    }

    try {
      // Extract path from URL
      const urlParts = fileUrl.split('/');
      const bucketName = bucketMap[type];
      const filePath = `${projectId}/${urlParts[urlParts.length - 1]}`;

      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from(bucketName)
        .remove([filePath]);

      if (storageError) throw storageError;

      // Delete from DB
      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .eq('id', docId);

      if (dbError) throw dbError;

      toast.success('Datei gelöscht');
      fetchDocuments();
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Fehler beim Löschen');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderTabContent = (type: DocumentType) => {
    const filteredDocs = documents.filter(doc => doc.typ === type);

    return (
      <div className="space-y-4">
        {/* Upload Area */}
        <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary transition-colors cursor-pointer">
          <input
            type="file"
            multiple
            accept={type === 'photos' ? 'image/*,application/pdf' : '*'}
            capture="environment"
            onChange={(e) => handleUpload(type, e.target.files)}
            className="hidden"
            id={`upload-${type}`}
            disabled={uploading === type}
          />
          <label htmlFor={`upload-${type}`} className="cursor-pointer">
            <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
            <p className="text-sm font-medium">
              {uploading === type ? 'Wird hochgeladen...' : 'Dateien hier ablegen oder klicken'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Mehrere Dateien auswählen möglich (Strg/Cmd + Klick)
            </p>
            <p className="text-xs text-primary font-medium mt-2">
              📱 Tipp: Mit Handy-Kamera Dokumente scannen/fotografieren
            </p>
          </label>
        </div>

        {/* Dateiliste */}
        <ScrollArea className="h-[400px]">
          {loading ? (
            <p className="text-center text-muted-foreground py-8">Lädt...</p>
          ) : filteredDocs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Keine Dateien vorhanden</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredDocs.map((doc) => (
                <Card key={doc.id} className="overflow-hidden">
                  {type === 'photos' && (
                    <div className="aspect-video w-full overflow-hidden bg-muted">
                      <img
                        src={doc.file_url}
                        alt={doc.name}
                        className="w-full h-full object-cover hover:scale-105 transition-transform"
                      />
                    </div>
                  )}
                  <CardContent className="p-3">
                    <p className="font-medium text-sm truncate mb-1">{doc.name}</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      {formatDate(doc.created_at)}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadFile(doc.file_url, doc.name)}
                        className="flex-1"
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Download
                      </Button>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteFile(doc.id, doc.file_url, type)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    );
  };

  // Get tabs based on admin status
  const baseTabs: DocumentType[] = ['photos', 'plans', 'reports', 'materials'];
  const availableTabs = isAdmin ? [...baseTabs, 'chef'] : baseTabs;

  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList className={`grid w-full ${isAdmin ? 'grid-cols-5' : 'grid-cols-4'}`}>
        <TabsTrigger value="photos" className="gap-1">
          {iconMap.photos}
          <span className="hidden sm:inline">Fotos</span>
        </TabsTrigger>
        <TabsTrigger value="plans" className="gap-1">
          {iconMap.plans}
          <span className="hidden sm:inline">Pläne</span>
        </TabsTrigger>
        <TabsTrigger value="reports" className="gap-1">
          {iconMap.reports}
          <span className="hidden sm:inline">Berichte</span>
        </TabsTrigger>
        <TabsTrigger value="materials" className="gap-1">
          {iconMap.materials}
          <span className="hidden sm:inline">Material</span>
        </TabsTrigger>
        {isAdmin && (
          <TabsTrigger value="chef" className="gap-1">
            {iconMap.chef}
            <span className="hidden sm:inline">Chef</span>
          </TabsTrigger>
        )}
      </TabsList>

      {availableTabs.map(type => (
        <TabsContent key={type} value={type}>
          {renderTabContent(type as DocumentType)}
        </TabsContent>
      ))}
    </Tabs>
  );
}
