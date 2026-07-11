import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface WelcomeVideoDialogProps {
  open: boolean;
  onContinue: () => void;
  onSkip: () => void;
  isReplay?: boolean;
}

export function WelcomeVideoDialog({ 
  open, 
  onContinue, 
  onSkip,
  isReplay = false 
}: WelcomeVideoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onSkip()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isReplay 
              ? "App zum Startbildschirm hinzufügen" 
              : "Willkommen bei Ruff Michael"}
          </DialogTitle>
          <DialogDescription>
            In diesem Video zeigen wir Ihnen, wie Sie die App auf Ihrem 
            Startbildschirm speichern können.
          </DialogDescription>
        </DialogHeader>
        
        {/* Portrait video container */}
        <div className="aspect-[9/16] max-h-[70vh] mx-auto bg-muted rounded-lg flex items-center justify-center">
          <video 
            controls 
            className="w-full h-full rounded-lg object-contain"
            poster="/placeholder.svg"
          >
            <source src="/videos/homescreen-anleitung.mp4" type="video/mp4" />
            Ihr Browser unterstützt keine Videos.
          </video>
        </div>

        <div className="flex justify-end">
          {isReplay ? (
            <Button onClick={onSkip}>Schließen</Button>
          ) : (
            <Button onClick={onContinue}>Weiter zur Anleitung</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}