import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Pencil,
  Slash,
  Square,
  Circle,
  Type,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Save,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { saveUpload } from "@/lib/offlineData";
import { fetchActiveProjectsCached } from "@/lib/cachedQueries";
import { projectLabel } from "@/lib/projectLabel";
import { fileTimestamp } from "@/components/ErstaufnahmeDialog";
import { useToast } from "@/hooks/use-toast";

// Wandelt einen Dateinamen in einen gültigen Supabase-Storage-Key um
// (Umlaute transliterieren, restliche Sonderzeichen ersetzen).
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

// ---------------------------------------------------------------------------
// Vektor-Modell: Jede Zeichenaktion ist eine Form. Dadurch sind Rückgängig/
// Wiederholen exakt (Form für Form) und der Export bleibt gestochen scharf.
//
// Koordinaten liegen im „Zeichenraum“: ohne Hintergrundfoto sind das
// CSS-Pixel der Fläche, mit Foto die echten Pixel des Fotos. So bleiben Striche
// beim Drehen des Handys exakt auf der Stelle des Fotos und der Export in
// Originalauflösung braucht keine Umrechnung.
// ---------------------------------------------------------------------------

type Point = { x: number; y: number };

type Shape =
  | { kind: "pen"; color: string; width: number; points: Point[]; erase?: boolean }
  | { kind: "line"; color: string; width: number; from: Point; to: Point }
  | { kind: "rect"; color: string; width: number; from: Point; to: Point }
  | { kind: "ellipse"; color: string; width: number; from: Point; to: Point }
  | { kind: "text"; color: string; size: number; pos: Point; text: string };

type Tool = "pen" | "line" | "rect" | "ellipse" | "text" | "eraser";

const COLORS = ["#111111", "#dc2626", "#2563eb", "#16a34a", "#F07002"];
const WIDTHS = [2, 4, 8];
// Textgröße an die gewählte Strichstärke gekoppelt (klein/mittel/groß).
const TEXT_SIZES: Record<number, number> = { 2: 18, 4: 28, 8: 44 };
// Fertige Skizzen auf Fotos nicht größer als 3000 px Kante exportieren –
// iOS begrenzt Canvas-Größen, und mehr Auflösung braucht kein Baustellenfoto.
const MAX_EXPORT_KANTE = 3000;

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Radierer nimmt auf der (transparenten) Strich-Ebene nur Striche weg –
  // ein Foto darunter bleibt unversehrt.
  ctx.globalCompositeOperation = s.kind === "pen" && s.erase ? "destination-out" : "source-over";
  if (s.kind === "text") {
    ctx.fillStyle = s.color;
    ctx.font = `${s.size}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(s.text, s.pos.x, s.pos.y);
    return;
  }
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  if (s.kind === "pen") {
    if (s.points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    if (s.points.length === 1) {
      // Einzelner Tipp: kleinen Punkt zeichnen
      ctx.lineTo(s.points[0].x + 0.1, s.points[0].y + 0.1);
    } else {
      for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    return;
  }
  if (s.kind === "line") {
    ctx.beginPath();
    ctx.moveTo(s.from.x, s.from.y);
    ctx.lineTo(s.to.x, s.to.y);
    ctx.stroke();
    return;
  }
  if (s.kind === "rect") {
    const x = Math.min(s.from.x, s.to.x);
    const y = Math.min(s.from.y, s.to.y);
    ctx.strokeRect(x, y, Math.abs(s.to.x - s.from.x), Math.abs(s.to.y - s.from.y));
    return;
  }
  if (s.kind === "ellipse") {
    const cx = (s.from.x + s.to.x) / 2;
    const cy = (s.from.y + s.to.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(s.to.x - s.from.x) / 2, Math.abs(s.to.y - s.from.y) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Alle Formen auf eine transparente Ebene zeichnen. `scale` = Ziel-Pixel je
// Zeichenraum-Einheit. Die Ebene wird danach über Foto bzw. Weiß gelegt.
function zeichneEbene(ebene: HTMLCanvasElement, shapes: Shape[], aktuell: Shape | null, scale: number) {
  const ctx = ebene.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ebene.width, ebene.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  for (const s of shapes) drawShape(ctx, s);
  if (aktuell) drawShape(ctx, aktuell);
  ctx.globalCompositeOperation = "source-over";
}

// Dateiname für die Skizze zu einem Foto: „IMG_1.jpg“ → „IMG_1_Skizze.jpg“,
// bei erneutem Bearbeiten „_Skizze2“, „_Skizze3“ … – das Original bleibt immer.
function skizzenName(original: string, vorhandene: string[]): string {
  const basis = original.replace(/\.[^.]+$/, "").replace(/_Skizze\d*$/i, "");
  const belegt = new Set(vorhandene.map((n) => n.toLowerCase()));
  for (let i = 1; i < 1000; i++) {
    const name = `${basis}_Skizze${i === 1 ? "" : i}.jpg`;
    if (!belegt.has(toStorageKey(name).toLowerCase())) return name;
  }
  return `${basis}_Skizze_${Date.now()}.jpg`;
}

type DrawingProject = {
  id: string;
  name: string;
  adresse: string | null;
  customers: { strasse: string | null; ort: string | null } | null;
};

export type SkizzenHintergrund = { bucket: string; path: string; name: string };

interface DrawingEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Optional vorausgewähltes Projekt (z.B. aus der Projekt-Übersicht heraus).
  defaultProjectId?: string;
  onSaved?: (projectId: string) => void;
  /** Foto, das als Hintergrund geladen und mit einer Skizze übermalt wird. */
  hintergrund?: SkizzenHintergrund;
  /** Projekt steht fest (z. B. aus dem Fotos-Ordner) – keine Auswahl anzeigen. */
  projektFest?: boolean;
  /** Anzeigename des festen Projekts (falls es nicht in der aktiven Liste steht). */
  projektName?: string;
  /** Dateinamen, die im Zielordner schon liegen – für einen freien Skizzen-Namen. */
  vorhandeneNamen?: string[];
}

// Voll funktionsfähiger Zeichnungs-Editor (Tablet/Stift/Finger via Pointer
// Events): Freihand, Linie, Rechteck, Ellipse, Text, Radierer, Farben,
// Strichstärken, Rückgängig/Wiederholen. Die fertige Zeichnung wird als PNG im
// Fotos-Ordner (project-photos) des gewählten Projekts gespeichert –
// offline-fähig über die Warteschlange.
//
// Mit `hintergrund` wird ein vorhandenes Foto geladen und die Skizze darauf
// gezeichnet; gespeichert wird eine NEUE JPG-Datei neben dem Original.
export function DrawingEditor({
  open,
  onOpenChange,
  defaultProjectId,
  onSaved,
  hintergrund,
  projektFest,
  projektName,
  vorhandeneNamen,
}: DrawingEditorProps) {
  const { toast } = useToast();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Transparente Strich-Ebene (wird bei jedem Neuzeichnen über den Hintergrund gelegt)
  const ebeneRef = useRef<HTMLCanvasElement | null>(null);
  // Zeichenraum-Einheiten je CSS-Pixel (1 ohne Foto; Foto-Pixel/CSS-Pixel mit Foto)
  const raumRef = useRef(1);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(4);

  const [shapes, setShapes] = useState<Shape[]>([]);
  const [undoStack, setUndoStack] = useState<Shape[][]>([]);
  const [redoStack, setRedoStack] = useState<Shape[][]>([]);
  // Aktuell entstehende Form während des Ziehens (noch nicht in der Historie).
  const currentRef = useRef<Shape | null>(null);

  // Text-Werkzeug: Position (Zeichenraum) + Eingabefeld-Overlay
  const [textDraft, setTextDraft] = useState<{ pos: Point; value: string } | null>(null);

  const [projects, setProjects] = useState<DrawingProject[]>([]);
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [saving, setSaving] = useState(false);

  // Hintergrundfoto + sichtbare Zeichenfläche (CSS-Pixel)
  const [bild, setBild] = useState<HTMLImageElement | null>(null);
  const [bildStatus, setBildStatus] = useState<"keins" | "laedt" | "fehler" | "ok">("keins");
  const [flaeche, setFlaeche] = useState({ w: 0, h: 0 });

  const bereit = !hintergrund || bildStatus === "ok";

  // Historien-Commit: neuer Stand => alter Stand auf den Undo-Stapel,
  // Redo-Stapel wird verworfen (Standard-Editor-Verhalten).
  const commit = useCallback((next: Shape[]) => {
    setUndoStack((u) => [...u, shapes]);
    setShapes(next);
    setRedoStack([]);
  }, [shapes]);

  const undo = () => {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const prev = u[u.length - 1];
      setRedoStack((r) => [...r, shapes]);
      setShapes(prev);
      return u.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      setUndoStack((u) => [...u, shapes]);
      setShapes(next);
      return r.slice(0, -1);
    });
  };

  // Beim Öffnen: Zustand zurücksetzen + aktive Projekte laden.
  useEffect(() => {
    if (!open) return;
    setShapes([]);
    setUndoStack([]);
    setRedoStack([]);
    setTextDraft(null);
    setTool("pen");
    // Auf einem Foto fällt Rot am meisten auf; leere Zeichnung startet schwarz.
    setColor(hintergrund ? COLORS[1] : COLORS[0]);
    setProjectId(defaultProjectId ?? "");
    (async () => {
      // Offline-fähig: Projektauswahl funktioniert auch ohne Netz.
      const { data } = await fetchActiveProjectsCached();
      setProjects((data as unknown as DrawingProject[]) ?? []);
    })();
  }, [open, defaultProjectId, hintergrund]);

  // Hintergrundfoto laden – über den Storage-Download (kein CORS-Problem, auch
  // für private Buckets), als Objekt-URL ins Bild.
  useEffect(() => {
    if (!open || !hintergrund) {
      setBild(null);
      setBildStatus("keins");
      return;
    }
    let aktiv = true;
    let url: string | null = null;
    setBild(null);
    setBildStatus("laedt");
    (async () => {
      const { data, error } = await supabase.storage.from(hintergrund.bucket).download(hintergrund.path);
      if (!aktiv) return;
      if (error || !data) {
        setBildStatus("fehler");
        toast({ variant: "destructive", title: "Foto nicht geladen", description: "Das Foto konnte nicht geöffnet werden — bitte Internetverbindung prüfen." });
        return;
      }
      url = URL.createObjectURL(data);
      const img = new Image();
      img.onload = () => {
        if (!aktiv) return;
        setBild(img);
        setBildStatus("ok");
      };
      img.onerror = () => {
        if (aktiv) setBildStatus("fehler");
      };
      img.src = url;
    })();
    return () => {
      aktiv = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hintergrund?.bucket, hintergrund?.path]);

  // Sichtbare Größe der Zeichenfläche: ohne Foto die ganze Box, mit Foto das
  // größtmögliche Rechteck im Seitenverhältnis des Fotos.
  const groesse = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return { w: 0, h: 0, k: 1 };
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (bild && bild.naturalWidth > 0 && bild.naturalHeight > 0) {
      const s = Math.min(W / bild.naturalWidth, H / bild.naturalHeight);
      return { w: Math.floor(bild.naturalWidth * s), h: Math.floor(bild.naturalHeight * s), k: 1 / s };
    }
    return { w: W, h: H, k: 1 };
  }, [bild]);

  // Canvas an die Fläche anpassen (inkl. Retina/dpr) und neu zeichnen.
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !wrapRef.current) return;
    const { w, h, k } = groesse();
    if (w <= 0 || h <= 0) return;
    raumRef.current = k;
    setFlaeche((f) => (f.w === w && f.h === h ? f : { w, h }));
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ebene = ebeneRef.current ?? (ebeneRef.current = document.createElement("canvas"));
    if (ebene.width !== pw || ebene.height !== ph) {
      ebene.width = pw;
      ebene.height = ph;
    }
    zeichneEbene(ebene, shapes, currentRef.current, dpr / k);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    if (bild) {
      ctx.drawImage(bild, 0, 0, pw, ph);
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pw, ph);
    }
    ctx.drawImage(ebene, 0, 0);
  }, [shapes, bild, groesse]);

  useEffect(() => {
    if (!open) return;
    // Nach dem Mount/Resize zeichnen (Dialog braucht einen Tick zum Layouten).
    const t = window.setTimeout(redraw, 30);
    window.addEventListener("resize", redraw);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", redraw);
    };
  }, [open, redraw]);

  useEffect(() => {
    redraw();
  }, [shapes, redraw]);

  const pointFromEvent = (e: React.PointerEvent | React.MouseEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const k = raumRef.current;
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k };
  };

  // Text wird erst beim ABGESCHLOSSENEN Klick platziert (nicht bei pointerdown):
  // sonst würde das gerade eingeblendete Eingabefeld vom selben Klick sofort
  // wieder den Fokus verlieren (blur) und verschwinden.
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "text" || !bereit) return;
    const p = pointFromEvent(e);
    // Offenen Text zuerst übernehmen, dann neues Textfeld an der Klickstelle.
    if (textDraft && textDraft.value.trim()) {
      commit([...shapes, { kind: "text", color, size: (TEXT_SIZES[width] ?? 28) * raumRef.current, pos: textDraft.pos, text: textDraft.value.trim() }]);
    }
    setTextDraft({ pos: p, value: "" });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Nur Primär-Zeiger (kein Zwei-Finger-Zoom-Geist); Text läuft über onClick.
    if (!e.isPrimary || tool === "text" || !bereit) return;
    const p = pointFromEvent(e);
    const k = raumRef.current;

    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    if (tool === "pen" || tool === "eraser") {
      currentRef.current = {
        kind: "pen",
        color,
        width: (tool === "eraser" ? width * 4 : width) * k,
        points: [p],
        erase: tool === "eraser" ? true : undefined,
      };
    } else if (tool === "line" || tool === "rect" || tool === "ellipse") {
      currentRef.current = { kind: tool, color, width: width * k, from: p, to: p };
    }
    redraw();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cur = currentRef.current;
    if (!cur || !e.isPrimary) return;
    const p = pointFromEvent(e);
    if (cur.kind === "pen") {
      const last = cur.points[cur.points.length - 1];
      // Mikrobewegungen filtern (glattere Linien, weniger Punkte) – Schwelle 1 CSS-Pixel
      if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < raumRef.current) return;
      cur.points.push(p);
    } else if (cur.kind !== "text") {
      cur.to = p;
    }
    redraw();
  };

  const handlePointerUp = () => {
    const cur = currentRef.current;
    if (!cur) return;
    currentRef.current = null;
    if (cur.kind !== "text") {
      commit([...shapes, cur]);
    }
  };

  const commitTextDraft = () => {
    if (textDraft && textDraft.value.trim()) {
      commit([...shapes, { kind: "text", color, size: (TEXT_SIZES[width] ?? 28) * raumRef.current, pos: textDraft.pos, text: textDraft.value.trim() }]);
    }
    setTextDraft(null);
  };

  // Export: ohne Foto als PNG in doppelter Auflösung (scharf auf Retina/Druck),
  // mit Foto als JPG in Originalauflösung (gedeckelt, siehe MAX_EXPORT_KANTE).
  const exportBild = (): Promise<Blob | null> => {
    const out = document.createElement("canvas");
    let scale: number;
    if (bild) {
      const f = Math.min(1, MAX_EXPORT_KANTE / Math.max(bild.naturalWidth, bild.naturalHeight));
      out.width = Math.round(bild.naturalWidth * f);
      out.height = Math.round(bild.naturalHeight * f);
      scale = f;
    } else {
      scale = 2;
      out.width = Math.round(flaeche.w * scale);
      out.height = Math.round(flaeche.h * scale);
    }
    if (out.width === 0 || out.height === 0) return Promise.resolve(null);
    const ctx = out.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    const ebene = document.createElement("canvas");
    ebene.width = out.width;
    ebene.height = out.height;
    zeichneEbene(ebene, shapes, null, scale);
    if (bild) {
      ctx.drawImage(bild, 0, 0, out.width, out.height);
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(ebene, 0, 0);
    return new Promise((resolve) =>
      bild ? out.toBlob((b) => resolve(b), "image/jpeg", 0.92) : out.toBlob((b) => resolve(b), "image/png"),
    );
  };

  const handleSave = async () => {
    if (!projectId || shapes.length === 0 || saving || !bereit) return;
    // Offenen Text noch übernehmen, damit nichts verloren geht.
    if (textDraft && textDraft.value.trim()) commitTextDraft();
    setSaving(true);
    try {
      const blob = await exportBild();
      if (!blob) {
        toast({ variant: "destructive", title: "Fehler", description: hintergrund ? "Skizze konnte nicht erstellt werden" : "Zeichnung konnte nicht erstellt werden" });
        return;
      }
      const project = projects.find((p) => p.id === projectId);
      const anzeige = project ? projectLabel(project) : (projektName ?? "Projekt");
      const dateiname = hintergrund
        ? skizzenName(hintergrund.name, vorhandeneNamen ?? [])
        : `Zeichnung_${fileTimestamp(new Date())}.png`;
      const path = `${projectId}/${toStorageKey(dateiname)}`;
      // In den Fotos-Ordner des Projekts (project-photos) – offline-fähig.
      const res = await saveUpload(
        { bucket: "project-photos", path, blob, contentType: hintergrund ? "image/jpeg" : "image/png", upsert: false },
        `${hintergrund ? "Skizze" : "Zeichnung"}: ${anzeige}`,
      );
      if (res.error) {
        toast({ variant: "destructive", title: "Fehler", description: hintergrund ? "Skizze konnte nicht gespeichert werden" : "Zeichnung konnte nicht gespeichert werden" });
        return;
      }
      const was = hintergrund ? "Skizze" : "Zeichnung";
      toast({
        title: res.queued ? `${was} offline gespeichert` : `${was} gespeichert`,
        description: res.queued
          ? `Wird synchronisiert, sobald wieder Netz da ist — Fotos von ${anzeige}`
          : hintergrund
            ? `Als „${dateiname}“ in den Fotos von ${anzeige} — das Original bleibt unverändert`
            : `Abgelegt in den Fotos von ${anzeige}`,
      });
      onSaved?.(projectId);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  // Am Handy größere Tippfläche (40px), am Desktop wie bisher kompakt (36px).
  const toolButton = (t: Tool, icon: React.ReactNode, label: string) => (
    <Button
      key={t}
      type="button"
      size="icon"
      variant={tool === t ? "default" : "outline"}
      onClick={() => { commitTextDraft(); setTool(t); }}
      title={label}
      aria-label={label}
      className="h-10 w-10 sm:h-9 sm:w-9 shrink-0"
    >
      {icon}
    </Button>
  );

  const festesProjekt = projects.find((p) => p.id === projectId);
  const festerName = festesProjekt ? projectLabel(festesProjekt) : (projektName ?? "dieses Projekt");
  const k = raumRef.current;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent className="max-w-[98vw] w-[98vw] h-[94dvh] p-3 sm:p-4 flex flex-col gap-2">
        <DialogHeader className="space-y-0.5 pr-8">
          <DialogTitle className="text-base sm:text-lg">
            {hintergrund ? "Foto mit Skizze bearbeiten" : "Zeichnung erstellen"}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {hintergrund
              ? "Direkt auf das Foto zeichnen, Formen und Text einfügen — das Original bleibt, die Skizze wird als neue Datei im Fotos-Ordner gespeichert."
              : "Frei zeichnen (auch mit Stift/Tablet), Formen und Text einfügen — wird im Fotos-Ordner des Projekts gespeichert."}
          </DialogDescription>
        </DialogHeader>

        {/* Werkzeugleiste — bricht am Handy in mehrere Zeilen um */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {toolButton("pen", <Pencil className="h-4 w-4" />, "Stift (frei zeichnen)")}
            {toolButton("line", <Slash className="h-4 w-4" />, "Linie")}
            {toolButton("rect", <Square className="h-4 w-4" />, "Rechteck")}
            {toolButton("ellipse", <Circle className="h-4 w-4" />, "Ellipse")}
            {toolButton("text", <Type className="h-4 w-4" />, "Text")}
            {toolButton("eraser", <Eraser className="h-4 w-4" />, "Radierer")}
          </div>

          {/* Trenner nur am größeren Bildschirm — am Handy umbricht die Leiste ohnehin */}
          <div className="hidden sm:block h-6 w-px bg-border" />

          {/* Farben */}
          <div className="flex flex-wrap items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={`Farbe ${c}`}
                aria-label={`Farbe ${c}`}
                className={`h-9 w-9 sm:h-7 sm:w-7 shrink-0 rounded-full border-2 ${color === c ? "ring-2 ring-primary ring-offset-1" : ""}`}
                style={{ backgroundColor: c, borderColor: "#e5e7eb" }}
              />
            ))}
          </div>

          {/* Trenner nur am größeren Bildschirm — am Handy umbricht die Leiste ohnehin */}
          <div className="hidden sm:block h-6 w-px bg-border" />

          {/* Strichstärke (steuert bei Text auch die Schriftgröße) */}
          <div className="flex flex-wrap items-center gap-1">
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWidth(w)}
                title={`Stärke ${w}`}
                aria-label={`Stärke ${w}`}
                className={`h-10 w-10 sm:h-9 sm:w-9 shrink-0 rounded-md border flex items-center justify-center ${width === w ? "border-primary bg-primary/10" : "border-input"}`}
              >
                <span className="rounded-full bg-foreground" style={{ width: w + 2, height: w + 2 }} />
              </button>
            ))}
          </div>

          {/* Trenner nur am größeren Bildschirm — am Handy umbricht die Leiste ohnehin */}
          <div className="hidden sm:block h-6 w-px bg-border" />

          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" size="icon" variant="outline" className="h-10 w-10 sm:h-9 sm:w-9 shrink-0" onClick={undo} disabled={undoStack.length === 0} title="Rückgängig" aria-label="Rückgängig">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="outline" className="h-10 w-10 sm:h-9 sm:w-9 shrink-0" onClick={redo} disabled={redoStack.length === 0} title="Wiederholen" aria-label="Wiederholen">
              <Redo2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-10 w-10 sm:h-9 sm:w-9 shrink-0"
              onClick={() => { setTextDraft(null); if (shapes.length > 0) commit([]); }}
              disabled={shapes.length === 0}
              title={hintergrund ? "Alle Striche löschen (Foto bleibt)" : "Alles löschen"}
              aria-label={hintergrund ? "Alle Striche löschen" : "Alles löschen"}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Zeichenfläche: die Box füllt den Platz, das Blatt/Foto liegt zentriert darin */}
        <div ref={wrapRef} className="relative flex-1 min-h-0 rounded-lg border bg-muted/40 overflow-hidden flex items-center justify-center">
          <div className="relative" style={{ width: flaeche.w, height: flaeche.h }}>
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full cursor-crosshair bg-white"
              style={{ touchAction: "none" }}
              onClick={handleCanvasClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
            {/* max-w: das Texteingabefeld darf am Handy nie breiter als die Zeichenfläche sein */}
            {textDraft && (
              <Input
                autoFocus
                value={textDraft.value}
                onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTextDraft();
                  if (e.key === "Escape") setTextDraft(null);
                }}
                onBlur={commitTextDraft}
                placeholder="Text eingeben…"
                className="absolute z-10 w-56 max-w-[calc(100%-1rem)] bg-white"
                style={{ left: Math.max(0, Math.min(textDraft.pos.x / k, flaeche.w - 230)), top: textDraft.pos.y / k }}
              />
            )}
          </div>
          {hintergrund && bildStatus !== "ok" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground px-4 text-center">
              {bildStatus === "fehler" ? (
                "Foto konnte nicht geladen werden."
              ) : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Foto wird geladen…
                </>
              )}
            </div>
          )}
        </div>

        {/* Projekt + Speichern */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1 min-w-0 space-y-1">
            {projektFest ? (
              <p className="text-sm text-muted-foreground truncate">
                Speicherort: Fotos von <span className="font-medium text-foreground">{festerName}</span>
              </p>
            ) : (
              <>
                <Label>Projekt (Speicherort: Fotos-Ordner) *</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Projekt auswählen" />
                  </SelectTrigger>
                  {/* Lange Projekt-/Adresstexte dürfen die Liste nicht über den Bildschirm hinaus ziehen */}
                  <SelectContent className="max-w-[calc(100vw-2rem)]">
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="break-words">
                        {projectLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
          <Button onClick={handleSave} disabled={!projectId || shapes.length === 0 || saving || !bereit} className="gap-2 sm:w-auto w-full shrink-0">
            <Save className="h-4 w-4" />
            {saving ? "Speichert…" : hintergrund ? "Skizze speichern" : "In Projekt speichern"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
