import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Smartphone, Share2, CheckCircle2, Apple, SquareArrowUp, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface InstallPromptDialogProps {
  open: boolean;
  onClose: () => void;
}

export function InstallPromptDialog({ open, onClose }: InstallPromptDialogProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<'ios' | 'android' | null>(null);
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  useEffect(() => {
    if (isStandalone) {
      setIsInstalled(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      toast({
        title: "App installiert!",
        description: "Die App wurde erfolgreich auf deinem Gerät installiert.",
      });
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, [isStandalone]);

  const handlePlatformSelect = (platform: 'ios' | 'android') => {
    setSelectedPlatform(platform);
    if (platform === 'ios') {
      setShowManualGuide(true);
    }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      toast({
        variant: "destructive",
        title: "Installation nicht verfügbar",
        description: "Bitte nutze die manuelle Anleitung für dein Gerät.",
      });
      setShowManualGuide(true);
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      toast({
        title: "Installation gestartet",
        description: "Die App wird jetzt installiert...",
      });
      onClose();
    }

    setDeferredPrompt(null);
  };

  const handleShowManual = () => {
    setShowManualGuide(true);
  };

  const handleBack = () => {
    if (showManualGuide) {
      setShowManualGuide(false);
      if (selectedPlatform === 'ios') {
        setSelectedPlatform(null);
      }
    } else if (selectedPlatform) {
      setSelectedPlatform(null);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {isInstalled 
              ? "App bereits installiert!" 
              : showManualGuide 
                ? "Installationsanleitung" 
                : "App installieren - Anleitung um deine App zum Startbildschirm hinzuzufügen"}
          </DialogTitle>
          <DialogDescription>
            {isInstalled 
              ? "Die App ist bereits installiert! Du kannst sie jederzeit verwenden."
              : showManualGuide
                ? "Folge diesen Schritten, um die App zu installieren:"
                : "Wähle zuerst deine Plattform aus:"}
          </DialogDescription>
        </DialogHeader>

        {/* Schritt 1: Plattformauswahl */}
        {!isInstalled && !selectedPlatform && !showManualGuide && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Card 
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary" 
              onClick={() => handlePlatformSelect('ios')}
            >
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <Apple className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">iOS / iPhone / iPad</CardTitle>
                <CardDescription>
                  Für Apple-Geräte (Safari Browser)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Weiter
                </Button>
              </CardContent>
            </Card>

            <Card 
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary" 
              onClick={() => handlePlatformSelect('android')}
            >
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <Smartphone className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">Android / Desktop</CardTitle>
                <CardDescription>
                  Für Android-Geräte und Desktop-Browser
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Weiter
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Schritt 2: Installationsoptionen für Android */}
        {!isInstalled && selectedPlatform === 'android' && !showManualGuide && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Card className="cursor-pointer hover:shadow-lg transition-all hover:border-primary" onClick={handleInstallClick}>
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <Smartphone className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">Direkt installieren</CardTitle>
                <CardDescription>
                  {deferredPrompt 
                    ? "Installation mit einem Klick starten" 
                    : "Auf diesem Gerät nicht verfügbar"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  className="w-full" 
                  disabled={!deferredPrompt}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleInstallClick();
                  }}
                >
                  Jetzt installieren
                </Button>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-lg transition-all hover:border-primary" onClick={handleShowManual}>
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <Share2 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">Anleitung ansehen</CardTitle>
                <CardDescription>
                  Schritt-für-Schritt Anleitung für Android
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleShowManual();
                  }}
                >
                  Anleitung zeigen
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Schritt 3: Manuelle Anleitung */}
        {showManualGuide && !isInstalled && (
          <div className="mt-4 space-y-4">
            <div className="bg-muted p-4 rounded-lg">
              {selectedPlatform === 'ios' ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                      <Share2 className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Für iPhone/iPad (Safari):</h3>
                      <ol className="list-decimal pl-5 space-y-2 text-sm">
                        <li className="flex items-center gap-2">Tippe unten (oder rechts oben) auf das Teilen Symbol <SquareArrowUp className="inline h-4 w-4" /> (Quadrat mit Pfeil nach oben)</li>
                        <li className="flex items-center gap-2">Scrolle nach unten und wähle "Zum Home-Bildschirm" <Plus className="inline h-4 w-4" /></li>
                        <li>Tippe oben rechts auf "Hinzufügen"</li>
                      </ol>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                      <Smartphone className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Für Android (Chrome/Edge):</h3>
                      <ol className="list-decimal pl-5 space-y-2 text-sm">
                        <li>Tippe oben rechts auf das Menü-Symbol (drei Punkte)</li>
                        <li>Wähle "App installieren" oder "Zum Startbildschirm hinzufügen"</li>
                        <li>Bestätige mit "Installieren"</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-primary/5 border border-primary/20 p-3 rounded-lg flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                Du findest die App dann immer am Homebildschirm
              </p>
            </div>
          </div>
        )}

        {/* App bereits installiert */}
        {isInstalled && (
          <div className="mt-4 bg-primary/5 border border-primary/20 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-primary" />
              <div>
                <h3 className="font-semibold">App bereits installiert!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Du kannst die App jederzeit verwenden.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 mt-6">
          {((selectedPlatform && !showManualGuide && selectedPlatform === 'android') || showManualGuide) && !isInstalled && (
            <Button variant="outline" onClick={handleBack}>
              Zurück
            </Button>
          )}
          <Button 
            onClick={onClose} 
            className="flex-1"
          >
            {isInstalled ? "Fertig" : showManualGuide ? "Verstanden" : "Fertig"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
