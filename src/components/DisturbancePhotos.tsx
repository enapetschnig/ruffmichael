import { useState, useEffect, useRef } from "react";
import { Camera, Trash2, X, ZoomIn, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface DisturbancePhoto {
  id: string;
  file_path: string;
  file_name: string;
  created_at: string;
}

interface DisturbancePhotosProps {
  disturbanceId: string;
  canEdit: boolean;
}

export const DisturbancePhotos = ({ disturbanceId, canEdit }: DisturbancePhotosProps) => {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<DisturbancePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchPhotos();
  }, [disturbanceId]);

  const fetchPhotos = async () => {
    const { data, error } = await supabase
      .from("disturbance_photos")
      .select("*")
      .eq("disturbance_id", disturbanceId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setPhotos(data);
    }
    setLoading(false);
  };

  const getPublicUrl = (filePath: string): string => {
    const { data } = supabase.storage
      .from("disturbance-photos")
      .getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Sie müssen angemeldet sein",
      });
      setUploading(false);
      return;
    }

    let uploadedCount = 0;

    for (const file of Array.from(files)) {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        toast({
          variant: "destructive",
          title: "Ungültiger Dateityp",
          description: `${file.name} ist kein Bild`,
        });
        continue;
      }

      // Max 10MB
      if (file.size > 10 * 1024 * 1024) {
        toast({
          variant: "destructive",
          title: "Datei zu groß",
          description: `${file.name} ist größer als 10MB`,
        });
        continue;
      }

      const fileName = `${disturbanceId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("disturbance-photos")
        .upload(fileName, file);

      if (uploadError) {
        toast({
          variant: "destructive",
          title: "Upload fehlgeschlagen",
          description: uploadError.message,
        });
        continue;
      }

      // Create database entry
      const { error: dbError } = await supabase
        .from("disturbance_photos")
        .insert({
          disturbance_id: disturbanceId,
          user_id: user.id,
          file_path: fileName,
          file_name: file.name,
        });

      if (dbError) {
        // Clean up storage if db insert failed
        await supabase.storage.from("disturbance-photos").remove([fileName]);
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Foto konnte nicht gespeichert werden",
        });
        continue;
      }

      uploadedCount++;
    }

    if (uploadedCount > 0) {
      toast({
        title: "Erfolg",
        description: `${uploadedCount} Foto${uploadedCount > 1 ? "s" : ""} hochgeladen`,
      });
      fetchPhotos();
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploading(false);
  };

  const handleDelete = async (photo: DisturbancePhoto) => {
    // Delete from storage
    await supabase.storage.from("disturbance-photos").remove([photo.file_path]);

    // Delete from database
    const { error } = await supabase
      .from("disturbance_photos")
      .delete()
      .eq("id", photo.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Foto konnte nicht gelöscht werden",
      });
    } else {
      toast({
        title: "Erfolg",
        description: "Foto gelöscht",
      });
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Fotos
            </CardTitle>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                {uploading ? "Lädt..." : "Foto hinzufügen"}
              </Button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Lädt Fotos...
            </div>
          ) : photos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Keine Fotos vorhanden
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {photos.map((photo) => (
                <div key={photo.id} className="relative group aspect-square">
                  <img
                    src={getPublicUrl(photo.file_path)}
                    alt={photo.file_name}
                    className="w-full h-full object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setSelectedPhoto(getPublicUrl(photo.file_path))}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg pointer-events-none" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 h-7 w-7 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                    onClick={() => setSelectedPhoto(getPublicUrl(photo.file_path))}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  {canEdit && (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute bottom-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDelete(photo)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fullscreen image dialog */}
      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden">
          <DialogClose className="absolute right-4 top-4 z-10 rounded-sm bg-black/50 p-2 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-5 w-5 text-white" />
            <span className="sr-only">Close</span>
          </DialogClose>
          {selectedPhoto && (
            <img
              src={selectedPhoto}
              alt="Vollbild"
              className="w-full h-full object-contain max-h-[90vh]"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
