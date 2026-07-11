import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, X, Check, RotateCcw, Upload, Info } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface MobilePhotoCaptureProps {
  open: boolean;
  onClose: () => void;
  onPhotoCapture: (file: File) => Promise<void>;
}

export function MobilePhotoCapture({ open, onClose, onPhotoCapture }: MobilePhotoCaptureProps) {
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      if (!capturedPhoto && !cameraStream) {
        // Try to auto-start camera on open (mobile browsers require user gesture; dialog open is triggered by a tap)
        startCamera();
      }
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [open]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false,
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Camera error:', error);
      toast({
        variant: "destructive",
        title: "Kamera-Fehler",
        description: "Zugriff auf Kamera wurde verweigert oder ist nicht verfügbar",
      });
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !cameraStream) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Kamera nicht aktiv",
      });
      return;
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Foto konnte nicht erstellt werden",
      });
      return;
    }
    
    ctx.drawImage(videoRef.current, 0, 0);
    setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.85));
    stopCamera();
  };

  const handleUpload = async () => {
    if (!capturedPhoto) return;

    setUploading(true);
    try {
      const res = await fetch(capturedPhoto);
      const blob = await res.blob();
      const timestamp = Date.now();
      const file = new File([blob], `photo_${timestamp}.jpg`, { type: 'image/jpeg' });

      await onPhotoCapture(file);
      
      toast({
        title: "Erfolg",
        description: "Foto wurde hochgeladen",
      });
      
      handleClose();
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        variant: "destructive",
        title: "Upload fehlgeschlagen",
        description: error.message || "Foto konnte nicht hochgeladen werden",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Zeige Vorschau
    const reader = new FileReader();
    reader.onload = (event) => {
      setCapturedPhoto(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleClose = () => {
    stopCamera();
    setCapturedPhoto(null);
    setUploading(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Foto aufnehmen oder auswählen
          </DialogTitle>
          <DialogDescription>
            Nutze die Kamera oder wähle ein Foto aus deiner Galerie
          </DialogDescription>
        </DialogHeader>
        
        <div className="px-4 pb-4 space-y-4">
          {!capturedPhoto ? (
            <>
              <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {!cameraStream && (
                  <div className="absolute inset-0 flex items-center justify-center text-white">
                    <p className="text-center px-4">Klicke auf "Kamera starten" oder wähle ein Foto aus</p>
                  </div>
                )}
              </div>
              
              <div className="sticky bottom-0 bg-card/95 border-t p-3 space-y-3">
                {!cameraStream ? (
                  <>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button onClick={startCamera} className="flex-1">
                        <Camera className="w-4 h-4 mr-2" />
                        Kamera starten
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                      <Button 
                        variant="outline" 
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Fotomediathek
                      </Button>
                    </div>
                    
                    {/* Hinweis für Google Fotos */}
                    <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
                      <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="text-xs text-muted-foreground">
                        <p className="font-medium mb-1">💡 Fotos aus Google Fotos hochladen?</p>
                        <p>Öffne die Google Fotos App → Wähle Foto(s) → Teilen → <strong>"Bild sichern"</strong> (speichert in Fotomediathek) oder <strong>"In Dateien sichern"</strong> → Dann hier hochladen.</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <Button onClick={capturePhoto} className="flex-1">
                      <Camera className="w-4 h-4 mr-2" />
                      Foto aufnehmen
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={handleClose}
                    >
                      <X className="w-4 h-4 mr-2" />
                      Abbrechen
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="relative rounded-lg overflow-hidden">
                <img 
                  src={capturedPhoto} 
                  alt="Aufgenommenes Foto" 
                  className="w-full h-auto"
                />
              </div>
              
              <div className="sticky bottom-0 bg-card/95 border-t p-3 flex flex-col sm:flex-row gap-2">
                <Button 
                  onClick={handleUpload} 
                  disabled={uploading}
                  className="flex-1"
                >
                  <Check className="w-4 h-4 mr-2" />
                  {uploading ? "Lädt hoch..." : "Hochladen"}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setCapturedPhoto(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  disabled={uploading}
                  className="flex-1"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Neu aufnehmen
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={handleClose}
                  disabled={uploading}
                >
                  <X className="w-4 h-4 mr-2" />
                  Abbrechen
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
