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
// ---------------------------------------------------------------------------

type Point = { x: number; y: number };

type Shape =
  | { kind: "pen"; color: string; width: number; points: Point[] }
  | { kind: "line"; color: string; width: number; from: Point; to: Point }
  | { kind: "rect"; color: string; width: number; from: Point; to: Point }
  | { kind: "ellipse"; color: string; width: number; from: Point; to: Point }
  | { kind: "text"; color: string; size: number; pos: Point; text: string };

type Tool = "pen" | "line" | "rect" | "ellipse" | "text" | "eraser";

const COLORS = ["#111111", "#dc2626", "#2563eb", "#16a34a", "#F07002"];
const WIDTHS = [2, 4, 8];
// Textgröße an die gewählte Strichstärke gekoppelt (klein/mittel/groß).
const TEXT_SIZES: Record<number, number> = { 2: 18, 4: 28, 8: 44 };

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
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

type DrawingProject = {
  id: string;
  name: string;
  adresse: string | null;
  customers: { strasse: string | null; ort: string | null } | null;
};

interface DrawingEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Optional vorausgewähltes Projekt (z.B. aus der Projekt-Übersicht heraus).
  defaultProjectId?: string;
  onSaved?: (projectId: string) => void;
}

// Voll funktionsfähiger Zeichnungs-Editor (Tablet/Stift/Finger via Pointer
// Events): Freihand, Linie, Rechteck, Ellipse, Text, Radierer, Farben,
// Strichstärken, Rückgängig/Wiederholen. Die fertige Zeichnung wird als PNG im
// Fotos-Ordner (project-photos) des gewählten Projekts gespeichert –
// offline-fähig über die Warteschlange.
export function DrawingEditor({ open, onOpenChange, defaultProjectId, onSaved }: DrawingEditorProps) {
  const { toast } = useToast();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(4);

  const [shapes, setShapes] = useState<Shape[]>([]);
  const [undoStack, setUndoStack] = useState<Shape[][]>([]);
  const [redoStack, setRedoStack] = useState<Shape[][]>([]);
  // Aktuell entstehende Form während des Ziehens (noch nicht in der Historie).
  const currentRef = useRef<Shape | null>(null);

  // Text-Werkzeug: Position + Eingabefeld-Overlay
  const [textDraft, setTextDraft] = useState<{ pos: Point; value: string } | null>(null);

  const [projects, setProjects] = useState<DrawingProject[]>([]);
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [saving, setSaving] = useState(false);

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
    setProjectId(defaultProjectId ?? "");
    (async () => {
      // Offline-fähig: Projektauswahl funktioniert auch ohne Netz.
      const { data } = await fetchActiveProjectsCached();
      setProjects((data as unknown as DrawingProject[]) ?? []);
    })();
  }, [open, defaultProjectId]);

  // Canvas an die Containergröße anpassen (inkl. Retina/dpr) und neu zeichnen.
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    for (const s of shapes) drawShape(ctx, s);
    if (currentRef.current) drawShape(ctx, currentRef.current);
  }, [shapes]);

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

  const pointFromEvent = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Text wird erst beim ABGESCHLOSSENEN Klick platziert (nicht bei pointerdown):
  // sonst würde das gerade eingeblendete Eingabefeld vom selben Klick sofort
  // wieder den Fokus verlieren (blur) und verschwinden.
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "text") return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    // Offenen Text zuerst übernehmen, dann neues Textfeld an der Klickstelle.
    if (textDraft && textDraft.value.trim()) {
      commit([...shapes, { kind: "text", color, size: TEXT_SIZES[width] ?? 28, pos: textDraft.pos, text: textDraft.value.trim() }]);
    }
    setTextDraft({ pos: p, value: "" });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Nur Primär-Zeiger (kein Zwei-Finger-Zoom-Geist); Text läuft über onClick.
    if (!e.isPrimary || tool === "text") return;
    const p = pointFromEvent(e);

    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    if (tool === "pen" || tool === "eraser") {
      currentRef.current = {
        kind: "pen",
        color: tool === "eraser" ? "#ffffff" : color,
        width: tool === "eraser" ? width * 4 : width,
        points: [p],
      };
    } else if (tool === "line" || tool === "rect" || tool === "ellipse") {
      currentRef.current = { kind: tool, color, width, from: p, to: p };
    }
    redraw();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cur = currentRef.current;
    if (!cur || !e.isPrimary) return;
    const p = pointFromEvent(e);
    if (cur.kind === "pen") {
      const last = cur.points[cur.points.length - 1];
      // Mikrobewegungen filtern (glattere Linien, weniger Punkte)
      if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 1) return;
      cur.points.push(p);
    } else if (cur.kind !== "text") {
      cur.to = p;
    }
    redraw();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cur = currentRef.current;
    if (!cur) return;
    currentRef.current = null;
    if (cur.kind !== "text") {
      commit([...shapes, cur]);
    }
  };

  const commitTextDraft = () => {
    if (textDraft && textDraft.value.trim()) {
      commit([...shapes, { kind: "text", color, size: TEXT_SIZES[width] ?? 28, pos: textDraft.pos, text: textDraft.value.trim() }]);
    }
    setTextDraft(null);
  };

  // Export als PNG in doppelter Auflösung (scharf auf Retina/Druck).
  const exportPng = (): Promise<Blob | null> => {
    const wrap = wrapRef.current;
    if (!wrap) return Promise.resolve(null);
    const rect = wrap.getBoundingClientRect();
    const scale = 2;
    const out = document.createElement("canvas");
    out.width = Math.round(rect.width * scale);
    out.height = Math.round(rect.height * scale);
    const ctx = out.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    for (const s of shapes) drawShape(ctx, s);
    return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
  };

  const handleSave = async () => {
    if (!projectId || shapes.length === 0 || saving) return;
    // Offenen Text noch übernehmen, damit nichts verloren geht.
    if (textDraft && textDraft.value.trim()) commitTextDraft();
    setSaving(true);
    try {
      const blob = await exportPng();
      if (!blob) {
        toast({ variant: "destructive", title: "Fehler", description: "Zeichnung konnte nicht erstellt werden" });
        return;
      }
      const project = projects.find((p) => p.id === projectId);
      const path = `${projectId}/${toStorageKey(`Zeichnung_${fileTimestamp(new Date())}.png`)}`;
      // In den Fotos-Ordner des Projekts (project-photos) – offline-fähig.
      const res = await saveUpload(
        { bucket: "project-photos", path, blob, contentType: "image/png", upsert: false },
        `Zeichnung: ${project?.name ?? "Projekt"}`
      );
      if (res.error) {
        toast({ variant: "destructive", title: "Fehler", description: "Zeichnung konnte nicht gespeichert werden" });
        return;
      }
      toast({
        title: res.queued ? "Zeichnung offline gespeichert" : "Zeichnung gespeichert",
        description: res.queued
          ? `Wird synchronisiert, sobald wieder Netz da ist — Fotos von ${project?.name ?? "Projekt"}`
          : `Abgelegt in den Fotos von ${project?.name ?? "Projekt"}`,
      });
      onSaved?.(projectId);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const toolButton = (t: Tool, icon: React.ReactNode, label: string) => (
    <Button
      key={t}
      type="button"
      size="icon"
      variant={tool === t ? "default" : "outline"}
      onClick={() => { commitTextDraft(); setTool(t); }}
      title={label}
      aria-label={label}
      className="h-9 w-9"
    >
      {icon}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent className="max-w-[98vw] w-[98vw] h-[94dvh] p-3 sm:p-4 flex flex-col gap-2">
        <DialogHeader className="space-y-0.5">
          <DialogTitle>Zeichnung erstellen</DialogTitle>
          <DialogDescription>
            Frei zeichnen (auch mit Stift/Tablet), Formen und Text einfügen — wird im Fotos-Ordner des Projekts gespeichert.
          </DialogDescription>
        </DialogHeader>

        {/* Werkzeugleiste */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            {toolButton("pen", <Pencil className="h-4 w-4" />, "Stift (frei zeichnen)")}
            {toolButton("line", <Slash className="h-4 w-4" />, "Linie")}
            {toolButton("rect", <Square className="h-4 w-4" />, "Rechteck")}
            {toolButton("ellipse", <Circle className="h-4 w-4" />, "Ellipse")}
            {toolButton("text", <Type className="h-4 w-4" />, "Text")}
            {toolButton("eraser", <Eraser className="h-4 w-4" />, "Radierer")}
          </div>

          <div className="h-6 w-px bg-border" />

          {/* Farben */}
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={`Farbe ${c}`}
                aria-label={`Farbe ${c}`}
                className={`h-7 w-7 rounded-full border-2 ${color === c ? "ring-2 ring-primary ring-offset-1" : ""}`}
                style={{ backgroundColor: c, borderColor: "#e5e7eb" }}
              />
            ))}
          </div>

          <div className="h-6 w-px bg-border" />

          {/* Strichstärke (steuert bei Text auch die Schriftgröße) */}
          <div className="flex items-center gap-1">
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWidth(w)}
                title={`Stärke ${w}`}
                aria-label={`Stärke ${w}`}
                className={`h-9 w-9 rounded-md border flex items-center justify-center ${width === w ? "border-primary bg-primary/10" : "border-input"}`}
              >
                <span className="rounded-full bg-foreground" style={{ width: w + 2, height: w + 2 }} />
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-border" />

          <div className="flex items-center gap-1">
            <Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={undo} disabled={undoStack.length === 0} title="Rückgängig" aria-label="Rückgängig">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={redo} disabled={redoStack.length === 0} title="Wiederholen" aria-label="Wiederholen">
              <Redo2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9"
              onClick={() => { setTextDraft(null); if (shapes.length > 0) commit([]); }}
              disabled={shapes.length === 0}
              title="Alles löschen"
              aria-label="Alles löschen"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Zeichenfläche */}
        <div ref={wrapRef} className="relative flex-1 min-h-0 rounded-lg border bg-white overflow-hidden">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full cursor-crosshair"
            style={{ touchAction: "none" }}
            onClick={handleCanvasClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
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
              className="absolute z-10 w-56 bg-white"
              style={{ left: Math.min(textDraft.pos.x, (wrapRef.current?.clientWidth ?? 300) - 230), top: textDraft.pos.y }}
            />
          )}
        </div>

        {/* Projekt + Speichern */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1 space-y-1">
            <Label>Projekt (Speicherort: Fotos-Ordner) *</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Projekt auswählen" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {projectLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSave} disabled={!projectId || shapes.length === 0 || saving} className="gap-2 sm:w-auto w-full">
            <Save className="h-4 w-4" />
            {saving ? "Speichert…" : "In Projekt speichern"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
