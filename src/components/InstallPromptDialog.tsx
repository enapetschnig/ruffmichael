import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Smartphone, Share2, CheckCircle2, Apple, SquareArrowUp, Plus, Download, Monitor, MonitorSmartphone } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  canInstallDirectly,
  isAppInstalled,
  promptInstall,
  onInstallStateChange,
  detectPlatform,
  detectBrowser,
  type PlatformKind,
} from "@/lib/pwaInstall";

interface InstallPromptDialogProps {
  open: boolean;
  // Onboarding bewusst abschließen (persistiert anleitung_completed = true).
  onClose: () => void;
  // Nur ausblenden (ESC/Overlay/X), OHNE das Onboarding als erledigt zu markieren –
  // damit ein versehentliches Schließen den Hinweis nicht dauerhaft unterdrückt.
  onDismiss?: () => void;
}

// Auf welchen Reiter (Anleitung) das erkannte Gerät standardmäßig springt.
function defaultTab(platform: PlatformKind): "windows" | "macos" | "ios" | "android" {
  if (platform === "ios") return "ios";
  if (platform === "android") return "android";
  if (platform === "macos") return "macos";
  return "windows"; // windows + other -> PC-Anleitung
}

const Step = ({ children }: { children: React.ReactNode }) => (
  <li className="text-sm leading-relaxed">{children}</li>
);

export function InstallPromptDialog({ open, onClose, onDismiss }: InstallPromptDialogProps) {
  const [installed, setInstalled] = useState(isAppInstalled());
  const [canDirect, setCanDirect] = useState(canInstallDirectly());
  const [installing, setInstalling] = useState(false);

  const platform = detectPlatform();
  const browser = detectBrowser();
  const [tab, setTab] = useState<string>(defaultTab(platform));

  // Auf Verfügbarkeit des nativen Installations-Prompts bzw. erfolgte
  // Installation reagieren (Event kann jederzeit eintreffen).
  useEffect(() => {
    const update = () => {
      setInstalled(isAppInstalled());
      setCanDirect(canInstallDirectly());
    };
    update();
    return onInstallStateChange(update);
  }, []);

  const handleInstallClick = async () => {
    setInstalling(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "accepted") {
        toast({
          title: "Installation gestartet",
          description: "Die App wird jetzt installiert …",
        });
        onClose();
      } else if (outcome === "unavailable") {
        toast({
          variant: "destructive",
          title: "Direktinstallation nicht verfügbar",
          description: "Bitte nutze die Schritt-für-Schritt-Anleitung für dein Gerät.",
        });
      }
    } finally {
      setInstalling(false);
    }
  };

  // ESC / Overlay-Klick / X: nur ausblenden (Dismiss), NICHT als erledigt
  // markieren. Nur der ausdrückliche Footer-Button schließt das Onboarding ab.
  const handleOpenChange = (o: boolean) => {
    if (!o) (onDismiss ?? onClose)();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {installed ? "App ist installiert" : "App installieren – auf Handy & PC"}
          </DialogTitle>
          <DialogDescription>
            {installed
              ? "Die App ist auf diesem Gerät bereits installiert. Du kannst sie jederzeit direkt öffnen."
              : canDirect
                ? "Auf diesem Gerät geht es mit einem Klick – oder folge der kurzen Anleitung für ein anderes Gerät."
                : "Folge der kurzen Schritt-für-Schritt-Anleitung für dein Gerät (Windows, Mac, iPhone oder Android)."}
          </DialogDescription>
        </DialogHeader>

        {/* Bereits installiert */}
        {installed && (
          <div className="mt-4 bg-primary/5 border border-primary/20 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-primary flex-shrink-0" />
              <div>
                <h3 className="font-semibold">Alles erledigt!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Du findest die App im Startmenü, im Dock oder auf dem Startbildschirm.
                </p>
              </div>
            </div>
          </div>
        )}

        {!installed && (
          <>
            {/* Ein-Klick-Installation (Chrome/Edge auf Windows, Mac & Android) */}
            {canDirect && (
              <div className="mt-4 rounded-lg border-2 border-primary bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MonitorSmartphone className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">Mit einem Klick installieren</h3>
                    <p className="text-sm text-muted-foreground">
                      Auf diesem Gerät möglich – einfach auf den Button tippen und bestätigen.
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full mt-3"
                  size="lg"
                  onClick={handleInstallClick}
                  disabled={installing}
                >
                  <Download className="h-5 w-5 mr-2" />
                  {installing ? "Wird installiert …" : "Jetzt installieren"}
                </Button>
              </div>
            )}

            {/* Anleitung je Gerät */}
            <div className="mt-5">
              <p className="text-sm font-medium mb-2">
                {canDirect
                  ? "Auf einem anderen Gerät installieren?"
                  : "So installierst du die App:"}
              </p>
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="windows" className="gap-1">
                    <Monitor className="h-4 w-4" />
                    <span className="hidden sm:inline">Windows</span>
                  </TabsTrigger>
                  <TabsTrigger value="macos" className="gap-1">
                    <Apple className="h-4 w-4" />
                    <span className="hidden sm:inline">Mac</span>
                  </TabsTrigger>
                  <TabsTrigger value="ios" className="gap-1">
                    <Share2 className="h-4 w-4" />
                    <span className="hidden sm:inline">iPhone</span>
                  </TabsTrigger>
                  <TabsTrigger value="android" className="gap-1">
                    <Smartphone className="h-4 w-4" />
                    <span className="hidden sm:inline">Android</span>
                  </TabsTrigger>
                </TabsList>

                {/* Windows */}
                <TabsContent value="windows" className="mt-3">
                  <div className="bg-muted p-4 rounded-lg space-y-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-primary" /> Windows-PC (Chrome, Edge oder Brave)
                    </h3>
                    <ol className="list-decimal pl-5 space-y-2">
                      <Step>Oben auf <strong>„Jetzt installieren"</strong> klicken (falls angezeigt) – fertig mit einem Klick.</Step>
                      <Step>Sonst rechts in der Adressleiste auf das <strong>Installieren-Symbol</strong> (Bildschirm mit Pfeil nach unten) klicken.</Step>
                      <Step>Alternativ im Menü <strong>⋮</strong> / <strong>…</strong> den Eintrag <strong>„App installieren"</strong> wählen (bei Edge unter <strong>„Apps"</strong>, bei Chrome unter <strong>„Speichern und teilen"</strong>).</Step>
                      <Step>Mit <strong>„Installieren"</strong> bestätigen – die App liegt danach im Startmenü.</Step>
                    </ol>
                    {browser === "firefox" && (
                      <p className="text-xs text-muted-foreground">
                        Hinweis: Firefox kann keine Apps installieren. Bitte Chrome, Edge oder (am Mac) Safari verwenden.
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* Mac */}
                <TabsContent value="macos" className="mt-3">
                  <div className="bg-muted p-4 rounded-lg space-y-4">
                    <div className="space-y-2">
                      <h3 className="font-semibold flex items-center gap-2">
                        <Apple className="h-4 w-4 text-primary" /> Mac mit Safari
                      </h3>
                      <ol className="list-decimal pl-5 space-y-2">
                        <Step>In der <strong>Menüleiste oben</strong> auf <strong>„Ablage"</strong> klicken.</Step>
                        <Step>
                          <strong>„Zum Dock hinzufügen …"</strong> wählen
                          <span className="block text-xs text-muted-foreground mt-0.5">(benötigt macOS Sonoma oder neuer).</span>
                        </Step>
                        <Step>Mit <strong>„Hinzufügen"</strong> bestätigen – die App erscheint im Dock.</Step>
                      </ol>
                    </div>
                    <div className="space-y-2 border-t pt-3">
                      <h3 className="font-semibold flex items-center gap-2">
                        <Monitor className="h-4 w-4 text-primary" /> Mac mit Chrome oder Edge
                      </h3>
                      <ol className="list-decimal pl-5 space-y-2">
                        <Step>Oben auf <strong>„Jetzt installieren"</strong> klicken (ein Klick) – oder das <strong>Installieren-Symbol</strong> in der Adressleiste.</Step>
                        <Step>Mit <strong>„Installieren"</strong> bestätigen – die App erscheint im Launchpad.</Step>
                      </ol>
                    </div>
                    {browser === "firefox" && (
                      <p className="text-xs text-muted-foreground">
                        Hinweis: Firefox kann keine Apps installieren. Bitte Safari, Chrome oder Edge verwenden.
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* iPhone / iPad */}
                <TabsContent value="ios" className="mt-3">
                  <div className="bg-muted p-4 rounded-lg space-y-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Apple className="h-4 w-4 text-primary" /> iPhone / iPad (Safari)
                    </h3>
                    <ol className="list-decimal pl-5 space-y-2">
                      <Step>
                        <span className="flex items-center gap-1">Unten (bzw. rechts oben) auf das <strong>Teilen-Symbol</strong> <SquareArrowUp className="inline h-4 w-4" /> tippen.</span>
                      </Step>
                      <Step>
                        <span className="flex items-center gap-1">Nach unten scrollen und <strong>„Zum Home-Bildschirm"</strong> <Plus className="inline h-4 w-4" /> wählen.</span>
                      </Step>
                      <Step>Oben rechts auf <strong>„Hinzufügen"</strong> tippen.</Step>
                    </ol>
                    <p className="text-xs text-muted-foreground">
                      Wichtig: Am iPhone/iPad geht das nur in <strong>Safari</strong> – nicht in Chrome, Firefox oder Edge.
                    </p>
                  </div>
                </TabsContent>

                {/* Android */}
                <TabsContent value="android" className="mt-3">
                  <div className="bg-muted p-4 rounded-lg space-y-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Smartphone className="h-4 w-4 text-primary" /> Android (Chrome)
                    </h3>
                    <ol className="list-decimal pl-5 space-y-2">
                      <Step>Oben auf <strong>„Jetzt installieren"</strong> tippen (falls angezeigt) – fertig.</Step>
                      <Step>Sonst oben rechts auf das <strong>Menü</strong> (drei Punkte) tippen.</Step>
                      <Step><strong>„App installieren"</strong> bzw. <strong>„Zum Startbildschirm hinzufügen"</strong> wählen.</Step>
                      <Step>Mit <strong>„Installieren"</strong> bestätigen.</Step>
                    </ol>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="mt-4 bg-primary/5 border border-primary/20 p-3 rounded-lg flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                Danach findest du die App wie ein normales Programm – am PC im Startmenü/Dock,
                am Handy auf dem Startbildschirm.
              </p>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="flex gap-3 mt-6">
          <Button onClick={onClose} className="flex-1">
            {installed ? "Fertig" : "Verstanden"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
