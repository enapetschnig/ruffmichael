import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Camera,
  Check,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Save,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { saveUpload } from "@/lib/offlineData";
import { fetchActiveProjectsCached } from "@/lib/cachedQueries";
import { projectLabel } from "@/lib/projectLabel";

// Storage-Key ohne Umlaute/Sonderzeichen (Supabase lehnt Nicht-ASCII-Keys ab).
const toStorageKey = (name: string) =>
  name
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9._ ()-]/g, "_");

const p2 = (n: number) => String(n).padStart(2, "0");
// Mit Sekunden, damit zwei Aufnahme-Serien in derselben Minute nicht kollidieren.
const zeitstempel = (d = new Date()) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;

// Galeriebilder (oft 12–48 Megapixel) auf eine Kante von max. 2560 px bringen:
// reicht für jedes Typenschild, lädt auf der Baustelle aber um ein Vielfaches
// schneller hoch. Kamera-Aufnahmen sind ohnehin kleiner und bleiben unangetastet.
// Klappt das Lesen nicht (z. B. exotisches Format), geht die Datei unverändert hoch.
const MAX_KANTE = 2560;
async function verkleinern(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Bild nicht lesbar"));
      i.src = url;
    });
    const lang = Math.max(img.naturalWidth, img.naturalHeight);
    if (!lang || lang <= MAX_KANTE) return file;
    const s = MAX_KANTE / lang;
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Aufnahme = { id: string; file: File; vorschau: string; ausGalerie: boolean };

type Projekt = {
  id: string;
  name: string;
  adresse: string | null;
  customers: { strasse: string | null; ort: string | null } | null;
};

type FitModus = "fit" | "fill";
type ZoomGrenzen = { min: number; max: number; step: number };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Projekt steht schon fest (z. B. aus dem Fotos-Ordner heraus) – die Zuordnung entfällt. */
  defaultProjectId?: string;
  /** Anzeigename des festen Projekts (für die Rückmeldung). */
  projektName?: string;
  onSaved?: (projectId: string, anzahl: number) => void;
}

/**
 * Serienaufnahme im Vollbild mit der App-eigenen Kamera: ein Tipp pro Foto, die
 * Kamera bleibt offen, unten wächst die Mini-Galerie. Danach wird das Projekt
 * gewählt und alle Fotos landen in dessen Fotos-Ordner (project-photos) –
 * offline-fähig über die Warteschlange; der OneDrive-Abgleich holt sie von dort
 * in den Ordner „Fotos“ des Projekts.
 *
 * Zoom: Hardware-Zoom, wo der Browser ihn kann (Chromium/Android), sonst
 * digitaler Zoom (Vorschau per CSS, Aufnahme per mittigem Ausschnitt) – so
 * verhält sich die Kamera auf iPhone und Android gleich.
 */
export function FotoAufnahme({ open, onOpenChange, defaultProjectId, projektName, onSaved }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const galerieInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pinchRef = useRef<{ startAbstand: number; startZoom: number } | null>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  const [aufnahmen, setAufnahmen] = useState<Aufnahme[]>([]);
  const [phase, setPhase] = useState<"kamera" | "zuordnen">("kamera");
  const [speichert, setSpeichert] = useState(false);
  const [fortschritt, setFortschritt] = useState(0);
  const [blitz, setBlitz] = useState(false);
  const [streamBereit, setStreamBereit] = useState(false);
  const [fitModus, setFitModus] = useState<FitModus>("fit");
  const [zoom, setZoom] = useState(1);
  const [zoomGrenzen, setZoomGrenzen] = useState<ZoomGrenzen | null>(null);
  const [hardwareZoom, setHardwareZoom] = useState(false);
  const [projekte, setProjekte] = useState<Projekt[]>([]);
  const [projektId, setProjektId] = useState<string>(defaultProjectId ?? "");

  const kameraOffen = open && phase === "kamera";

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreamBereit(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStreamBereit(true);

      // Hardware-Zoom ist im TS-DOM-Typ (noch) nicht enthalten – daher der Cast.
      const [track] = stream.getVideoTracks();
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        zoom?: { min: number; max: number; step: number };
      };
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        setZoomGrenzen({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
        setHardwareZoom(true);
        setZoom(caps.zoom.min || 1);
      } else {
        setZoomGrenzen({ min: 1, max: 4, step: 0.1 });
        setHardwareZoom(false);
        setZoom(1);
      }
    } catch (err) {
      console.error("Kamera-Fehler:", err);
      toast({
        variant: "destructive",
        title: "Kamera nicht verfügbar",
        description: "Zugriff verweigert oder keine Kamera gefunden. Du kannst Fotos aus der Galerie wählen.",
      });
      setStreamBereit(false);
    }
  }, []);

  // Hardware-Zoom anwenden; schlägt das fehl, digital weiterzoomen.
  useEffect(() => {
    if (!hardwareZoom || !streamBereit) return;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track
      .applyConstraints({ advanced: [{ zoom } as unknown as MediaTrackConstraintSet] })
      .catch(() => setHardwareZoom(false));
  }, [zoom, hardwareZoom, streamBereit]);

  // Kamera läuft genau dann, wenn der Kamera-Dialog sichtbar ist.
  useEffect(() => {
    if (kameraOffen) {
      setFitModus("fit");
      setZoom(1);
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [kameraOffen, startCamera, stopCamera]);

  // Beim Öffnen: sauberer Start + Projektliste (offline aus dem Zwischenspeicher).
  useEffect(() => {
    if (!open) return;
    setAufnahmen((alt) => {
      alt.forEach((a) => URL.revokeObjectURL(a.vorschau));
      return [];
    });
    setPhase("kamera");
    setSpeichert(false);
    setFortschritt(0);
    setProjektId(defaultProjectId ?? "");
    (async () => {
      const { data } = await fetchActiveProjectsCached();
      setProjekte((data as unknown as Projekt[]) ?? []);
    })();
  }, [open, defaultProjectId]);

  const fotoAufnehmen = () => {
    const video = videoRef.current;
    if (!video || !streamRef.current || !streamBereit) {
      toast({ variant: "destructive", title: "Kamera nicht aktiv", description: "Bitte kurz warten oder aus der Galerie wählen." });
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width) {
      toast({ variant: "destructive", title: "Fehler", description: "Foto konnte nicht erstellt werden." });
      return;
    }
    // Hardware-Zoom liefert das Bild schon gezoomt; digitaler Zoom = mittiger Ausschnitt.
    if (hardwareZoom || zoom === 1) {
      ctx.drawImage(video, 0, 0);
    } else {
      const sw = video.videoWidth / zoom;
      const sh = video.videoHeight / zoom;
      ctx.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], "foto.jpg", { type: "image/jpeg" });
        setAufnahmen((alt) => [...alt, { id: crypto.randomUUID(), file, vorschau: URL.createObjectURL(blob), ausGalerie: false }]);
      },
      "image/jpeg",
      0.9,
    );
    setBlitz(true);
    setTimeout(() => setBlitz(false), 120);
  };

  const entfernen = (id: string) => {
    setAufnahmen((alt) => {
      const ziel = alt.find((a) => a.id === id);
      if (ziel) URL.revokeObjectURL(ziel.vorschau);
      return alt.filter((a) => a.id !== id);
    });
  };

  const galerieDateien = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    setAufnahmen((alt) => [
      ...alt,
      ...files.map((file) => ({ id: crypto.randomUUID(), file, vorschau: URL.createObjectURL(file), ausGalerie: true })),
    ]);
  };

  const aufraeumen = () => {
    aufnahmen.forEach((a) => URL.revokeObjectURL(a.vorschau));
    setAufnahmen([]);
  };

  const abbrechen = () => {
    if (speichert) return;
    if (aufnahmen.length > 0) {
      const ok = window.confirm(`${aufnahmen.length} ${aufnahmen.length === 1 ? "Foto" : "Fotos"} verwerfen?`);
      if (!ok) return;
    }
    aufraeumen();
    onOpenChange(false);
  };

  const speichern = async (zielProjekt: string) => {
    if (!zielProjekt || aufnahmen.length === 0 || speichert) return;
    const projekt = projekte.find((p) => p.id === zielProjekt);
    const anzeige = projekt ? projectLabel(projekt) : (projektName ?? "Projekt");
    setSpeichert(true);
    setFortschritt(0);
    let ok = 0;
    let wartend = 0;
    let fehler: string | null = null;
    const ts = zeitstempel();
    try {
      for (let i = 0; i < aufnahmen.length; i++) {
        const a = aufnahmen[i];
        const file = a.ausGalerie ? await verkleinern(a.file) : a.file;
        const dateiname = a.ausGalerie
          ? `${ts}_${i + 1}_${toStorageKey(file.name)}`
          : `Foto_${ts}_${i + 1}.jpg`;
        const res = await saveUpload(
          { bucket: "project-photos", path: `${zielProjekt}/${dateiname}`, blob: file, contentType: file.type || "image/jpeg", upsert: false },
          `Foto: ${dateiname}`,
        );
        if (res.error) {
          if (!fehler) fehler = res.error;
        } else if (res.queued) {
          wartend++;
        } else {
          ok++;
        }
        setFortschritt(i + 1);
      }
    } finally {
      setSpeichert(false);
    }

    if (fehler) {
      toast({ variant: "destructive", title: "Upload fehlgeschlagen", description: fehler });
    }
    if (wartend > 0) {
      toast({
        title: "Offline gespeichert",
        description: `${wartend} ${wartend === 1 ? "Foto wird" : "Fotos werden"} gesendet, sobald wieder Netz da ist — Fotos von ${anzeige}`,
      });
    }
    if (ok > 0) {
      toast({
        title: ok === 1 ? "Foto gespeichert" : `${ok} Fotos gespeichert`,
        description: `Abgelegt in den Fotos von ${anzeige}`,
      });
    }
    if (ok + wartend > 0) {
      aufraeumen();
      onSaved?.(zielProjekt, ok + wartend);
      onOpenChange(false);
    }
  };

  const fertig = () => {
    if (aufnahmen.length === 0) return;
    if (defaultProjectId) {
      void speichern(defaultProjectId);
      return;
    }
    // Kamera geht aus (Effekt), der Zuordnungs-Dialog erscheint.
    setPhase("zuordnen");
  };

  // ===== Pinch-Zoom =====
  const abstand = (t1: React.Touch, t2: React.Touch) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) pinchRef.current = { startAbstand: abstand(e.touches[0], e.touches[1]), startZoom: zoom };
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2 || !pinchRef.current || !zoomGrenzen) return;
    e.preventDefault();
    const faktor = abstand(e.touches[0], e.touches[1]) / pinchRef.current.startAbstand;
    const neu = pinchRef.current.startZoom * faktor;
    setZoom(Number(Math.min(zoomGrenzen.max, Math.max(zoomGrenzen.min, neu)).toFixed(2)));
  };
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) pinchRef.current = null;
  };
  const zoomSetzen = (wert: number) => {
    if (!zoomGrenzen) return;
    setZoom(Math.min(zoomGrenzen.max, Math.max(zoomGrenzen.min, Number(wert.toFixed(2)))));
  };

  const anzahlText = `${aufnahmen.length} ${aufnahmen.length === 1 ? "Foto" : "Fotos"}`;

  return (
    <>
      {/* ---------- Kamera (Vollbild) ---------- */}
      <Dialog open={kameraOffen} onOpenChange={(o) => { if (!o) abbrechen(); }}>
        <DialogContent
          hideClose
          // Kein versehentliches Schließen per Escape/Tipp daneben – Fotos gingen sonst verloren.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="max-w-full w-screen h-[100dvh] p-0 m-0 border-0 rounded-none bg-black flex flex-col gap-0 sm:max-w-full sm:rounded-none"
        >
          {/* Kopfzeile */}
          <div className="flex items-center justify-between px-3 py-2 bg-black/90 text-white shrink-0">
            <Button variant="ghost" size="sm" onClick={abbrechen} disabled={speichert} className="text-white hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5 mr-1" />
              Abbrechen
            </Button>
            <DialogTitle className="text-sm font-medium text-white truncate px-2">
              Fotos aufnehmen{aufnahmen.length > 0 ? ` · ${aufnahmen.length}` : ""}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Ein Tipp auf den runden Auslöser macht ein Foto. Mit „Fertig“ werden alle Fotos dem Projekt zugeordnet.
            </DialogDescription>
            <Button
              size="sm"
              onClick={fertig}
              disabled={speichert || aufnahmen.length === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {speichert ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  {fortschritt}/{aufnahmen.length}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-1" />
                  {defaultProjectId ? "Speichern" : "Fertig"}{aufnahmen.length > 0 ? ` (${aufnahmen.length})` : ""}
                </>
              )}
            </Button>
          </div>

          {/* Live-Vorschau; touch-none, damit der Browser das Pinchen nicht selbst abfängt */}
          <div
            className="flex-1 relative overflow-hidden bg-black touch-none"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn("absolute inset-0 w-full h-full", fitModus === "fit" ? "object-contain" : "object-cover")}
              style={
                !hardwareZoom && zoom > 1
                  ? { transform: `scale(${zoom})`, transformOrigin: "center center", transition: "transform 60ms linear" }
                  : undefined
              }
            />
            {blitz && <div className="absolute inset-0 bg-white opacity-60 pointer-events-none" />}
            {!streamBereit && (
              <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm px-6 text-center">
                Kamera wird gestartet… Falls nichts passiert: Kamera-Berechtigung prüfen oder unten links aus der Galerie wählen.
              </div>
            )}

            {streamBereit && (
              <button
                type="button"
                onClick={() => setFitModus((m) => (m === "fit" ? "fill" : "fit"))}
                className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-2 hover:bg-black/70"
                title={fitModus === "fit" ? "Vorschau bildschirmfüllend" : "Ganzes Kamerabild zeigen"}
                aria-label="Vorschau-Modus umschalten"
              >
                {fitModus === "fit" ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
              </button>
            )}

            {/* Zoom-Schnellwahl unten (1x / 2x / max) */}
            {streamBereit && zoomGrenzen && zoomGrenzen.max > zoomGrenzen.min && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/50 rounded-full px-2 py-1">
                {Array.from(
                  new Set([
                    zoomGrenzen.min,
                    ...(zoomGrenzen.min <= 1 && zoomGrenzen.max >= 1 ? [1] : []),
                    ...(zoomGrenzen.max >= 2 && zoomGrenzen.min < 2 ? [2] : []),
                    zoomGrenzen.max,
                  ]),
                )
                  .sort((a, b) => a - b)
                  .map((stufe) => {
                    const aktiv = Math.abs(zoom - stufe) < 0.05;
                    const label = Number.isInteger(stufe) ? `${stufe}x` : `${stufe.toFixed(1)}x`;
                    return (
                      <button
                        key={stufe}
                        type="button"
                        onClick={() => zoomSetzen(stufe)}
                        className={cn("rounded-full px-2 py-0.5 text-xs font-medium", aktiv ? "bg-white text-black" : "text-white/90 hover:bg-white/15")}
                        aria-label={`Zoom ${label}`}
                      >
                        {label}
                      </button>
                    );
                  })}
              </div>
            )}

            {/* Zoom-Schieber rechts (eigener Pointer-Schieber: iOS rendert vertikale range-Inputs unzuverlässig) */}
            {streamBereit && zoomGrenzen && zoomGrenzen.max > zoomGrenzen.min && (() => {
              const spanne = zoomGrenzen.max - zoomGrenzen.min;
              const anteil = spanne > 0 ? (zoom - zoomGrenzen.min) / spanne : 0;
              const setzeAusY = (clientY: number) => {
                const track = sliderRef.current;
                if (!track) return;
                const r = track.getBoundingClientRect();
                const a = 1 - Math.min(1, Math.max(0, (clientY - r.top) / r.height));
                zoomSetzen(zoomGrenzen.min + a * spanne);
              };
              return (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 bg-black/40 rounded-full px-1.5 py-2 select-none">
                  <button type="button" onClick={() => zoomSetzen(zoom + zoomGrenzen.step * 5)} className="text-white w-7 h-7 flex items-center justify-center hover:bg-white/15 rounded-full" aria-label="Näher">
                    <ZoomIn className="h-4 w-4" />
                  </button>
                  <div
                    ref={sliderRef}
                    role="slider"
                    aria-label="Zoom"
                    aria-valuemin={zoomGrenzen.min}
                    aria-valuemax={zoomGrenzen.max}
                    aria-valuenow={zoom}
                    tabIndex={0}
                    className="relative h-32 w-6 touch-none cursor-pointer"
                    onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setzeAusY(e.clientY); }}
                    onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setzeAusY(e.clientY); }}
                    onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
                    onPointerCancel={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
                  >
                    <div className="absolute left-1/2 -translate-x-1/2 top-1 bottom-1 w-1 bg-white/30 rounded-full" />
                    <div className="absolute left-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full shadow-md pointer-events-none" style={{ top: `calc(${(1 - anteil) * 100}% - 8px)` }} />
                  </div>
                  <button type="button" onClick={() => zoomSetzen(zoom - zoomGrenzen.step * 5)} className="text-white w-7 h-7 flex items-center justify-center hover:bg-white/15 rounded-full" aria-label="Weiter weg">
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <span className="text-white text-[10px] font-mono">{zoom.toFixed(1)}x</span>
                </div>
              );
            })()}
          </div>

          {/* Mini-Galerie der bisherigen Aufnahmen */}
          {aufnahmen.length > 0 && (
            <div className="flex gap-2 px-3 py-2 overflow-x-auto bg-black/90 shrink-0">
              {aufnahmen.map((a) => (
                <div key={a.id} className="relative shrink-0">
                  <img src={a.vorschau} alt="" className="h-16 w-16 object-cover rounded border border-white/30" />
                  <button
                    type="button"
                    onClick={() => entfernen(a.id)}
                    disabled={speichert}
                    className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full p-0.5 hover:bg-red-700"
                    title="Entfernen"
                    aria-label="Foto entfernen"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Auslöser-Leiste */}
          <div className="flex items-center justify-between px-6 py-4 bg-black shrink-0">
            <button
              type="button"
              onClick={() => galerieInputRef.current?.click()}
              disabled={speichert}
              className="h-12 w-12 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"
              title="Aus Galerie wählen"
              aria-label="Aus Galerie wählen"
            >
              <ImageIcon className="h-6 w-6" />
            </button>
            <input ref={galerieInputRef} type="file" accept="image/*" multiple className="hidden" onChange={galerieDateien} />

            <button
              type="button"
              onClick={fotoAufnehmen}
              disabled={!streamBereit || speichert}
              className="h-20 w-20 rounded-full bg-white border-4 border-white/40 active:scale-95 transition-transform disabled:opacity-50"
              title="Foto aufnehmen"
              aria-label="Foto aufnehmen"
            />

            <div className="h-12 w-12 flex items-center justify-center text-white/60">
              <Camera className="h-5 w-5" />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Zuordnung zum Projekt ---------- */}
      <Dialog open={open && phase === "zuordnen"} onOpenChange={(o) => { if (!o) abbrechen(); }}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fotos zuordnen</DialogTitle>
            <DialogDescription>
              In welches Projekt sollen die Fotos? Sie landen dort im Ordner „Fotos“ und werden mit OneDrive abgeglichen.
            </DialogDescription>
          </DialogHeader>

          {aufnahmen.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto py-1">
              {aufnahmen.map((a) => (
                <div key={a.id} className="relative shrink-0">
                  <img src={a.vorschau} alt="" className="h-16 w-16 object-cover rounded border" />
                  <button
                    type="button"
                    onClick={() => entfernen(a.id)}
                    disabled={speichert}
                    className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full p-0.5 hover:bg-red-700"
                    title="Entfernen"
                    aria-label="Foto entfernen"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Keine Fotos mehr ausgewählt.</p>
          )}

          <div className="space-y-1">
            <Label>Projekt *</Label>
            <Select value={projektId} onValueChange={setProjektId} disabled={speichert}>
              <SelectTrigger>
                <SelectValue placeholder="Projekt auswählen" />
              </SelectTrigger>
              <SelectContent className="max-w-[calc(100vw-2rem)]">
                {projekte.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="break-words">
                    {projectLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setPhase("kamera")} disabled={speichert} className="gap-2">
              <Camera className="h-4 w-4" />
              Weitere Fotos
            </Button>
            <Button
              onClick={() => speichern(projektId)}
              disabled={!projektId || aufnahmen.length === 0 || speichert}
              className="gap-2 flex-1"
            >
              {speichert ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Speichert {fortschritt} von {aufnahmen.length}…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {anzahlText} speichern
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
