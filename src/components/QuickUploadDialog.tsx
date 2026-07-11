import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, X, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";

type DocumentType = "plans" | "reports" | "materials" | "photos";

interface QuickUploadDialogProps {
  projectId: string;
  documentType?: DocumentType;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const bucketMap: Record<DocumentType, string> = {
  plans: "project-plans",
  reports: "project-reports",
  materials: "project-materials",
  photos: "project-photos",
};

const titleMap: Record<DocumentType, string> = {
  plans: "Pläne",
  reports: "Regieberichte",
  materials: "Materiallisten",
  photos: "Fotos",
};

export function QuickUploadDialog({ 
  projectId, 
  documentType = "photos", 
  open, 
  onClose,
  onSuccess 
}: QuickUploadDialogProps) {
  const { toast } = useToast();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      setSelectedFiles(filesArray);
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setUploadProgress(0);

    const bucket = bucketMap[documentType];
    let successCount = 0;

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const filePath = `${projectId}/${Date.now()}_${file.name}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error('Storage-Upload-Fehler:', uploadError);
        console.error('Datei:', file.name, 'Größe:', file.size, 'bytes');
        toast({
          variant: "destructive",
          title: "Upload fehlgeschlagen",
          description: `${file.name} (${(file.size / 1024).toFixed(0)} KB): ${uploadError.message}`
        });
        setUploading(false);
        return;
      }

      if (uploadData) {
        successCount++;
      }

      setUploadProgress(((i + 1) / selectedFiles.length) * 100);
    }

    setUploading(false);

    if (successCount > 0) {
      toast({
        title: "Erfolg",
        description: `${successCount} von ${selectedFiles.length} Datei(en) hochgeladen`,
      });
      
      if (onSuccess) {
        onSuccess();
      }
      
      setTimeout(() => {
        setSelectedFiles([]);
        setUploadProgress(0);
        onClose();
      }, 500);
    } else {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Dateien konnten nicht hochgeladen werden",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titleMap[documentType]} hochladen</DialogTitle>
          <DialogDescription>
            Wähle Dateien zum Hochladen aus
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drag & Drop Zone */}
          <label htmlFor="file-upload" className="cursor-pointer">
            <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">
                Dateien auswählen
              </p>
              <p className="text-xs text-muted-foreground">
                Klicken zum Auswählen oder Drag & Drop
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Max. 50 MB pro Datei
              </p>
            </div>
            <Input
              id="file-upload"
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              disabled={uploading}
              accept={documentType === "photos" ? "image/*" : "*"}
              multiple
            />
          </label>

          {/* Hinweis für Google Fotos */}
          {documentType === "photos" && (
            <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
              <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium mb-1">💡 Fotos aus Google Fotos hochladen?</p>
                <p>Öffne die Google Fotos App → Wähle Foto(s) → Teilen → <strong>"Bild sichern"</strong> (speichert in Fotomediathek) oder <strong>"In Dateien sichern"</strong> → Dann hier hochladen.</p>
              </div>
            </div>
          )}

          {/* Selected Files List */}
          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Ausgewählte Dateien ({selectedFiles.length})
              </p>
              {selectedFiles.map((file, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between p-2 bg-muted rounded-lg"
                >
                  <span className="text-sm truncate flex-1">{file.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFile(index)}
                    disabled={uploading}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Upload Progress */}
          {uploading && (
            <div className="space-y-2">
              <Progress value={uploadProgress} />
              <p className="text-xs text-center text-muted-foreground">
                {Math.round(uploadProgress)}% hochgeladen
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={onClose}
              disabled={uploading}
              className="flex-1"
            >
              Abbrechen
            </Button>
            <Button 
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || uploading}
              className="flex-1"
            >
              {uploading ? "Lädt hoch..." : "Hochladen"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
