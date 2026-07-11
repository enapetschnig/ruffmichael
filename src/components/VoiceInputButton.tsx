import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type VoiceMode = "time" | "disturbance" | "auto";

export interface VoiceContext {
  projects?: { id: string; name: string; plz: string | null; adresse?: string | null }[];
  employees?: { id: string; name: string }[];
  customers?: { name: string; email: string | null; adresse: string | null; telefon: string | null }[];
  materials?: string[];
  coreHours?: { start: string; end: string; pauseStart: string; pauseEnd: string };
}

export interface VoiceResult {
  transcription: string;
  extracted: any;
}

interface Props {
  mode: VoiceMode;
  context?: VoiceContext;
  existingData?: any;
  onResult: (result: VoiceResult) => void;
  label?: string;
  compact?: boolean;
  maxSeconds?: number;
}

type State =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; seconds: number; level: number }
  | { kind: "processing"; stage: string }
  | { kind: "error"; message: string; transcription?: string };

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const t of candidates) {
    // @ts-ignore
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "audio/webm";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const VoiceInputButton = ({
  mode,
  context,
  existingData,
  onResult,
  label = "Per Sprache ausfüllen",
  compact = false,
  maxSeconds = 180,
}: Props) => {
  const { toast } = useToast();
  const [state, setState] = useState<State>({ kind: "idle" });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const startTsRef = useRef<number>(0);
  const mimeRef = useRef<string>("audio/webm");

  const cleanup = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    timerRef.current = null;
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const startRecording = useCallback(async () => {
    setState({ kind: "requesting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = pickMime();
      mimeRef.current = mime;
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      // Waveform via AudioContext
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      startTsRef.current = Date.now();
      setState({ kind: "recording", seconds: 0, level: 0 });

      recorder.start();

      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTsRef.current) / 1000);
        if (elapsed >= maxSeconds) {
          stopRecording();
        } else {
          setState((s) => (s.kind === "recording" ? { ...s, seconds: elapsed } : s));
        }
      }, 250);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setState((s) => (s.kind === "recording" ? { ...s, level: Math.min(1, rms * 3) } : s));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      cleanup();
      const message = err instanceof Error ? err.message : "Mikrofon nicht verfügbar";
      setState({ kind: "error", message });
      toast({
        variant: "destructive",
        title: "Mikrofon-Zugriff verweigert",
        description: "Bitte erlaube den Zugriff auf das Mikrofon in den Browsereinstellungen.",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxSeconds, toast, cleanup]);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    setState({ kind: "processing", stage: "Aufnahme wird verarbeitet..." });

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.stop(); } catch { resolve(); }
    });

    const mime = mimeRef.current;
    const blob = new Blob(chunksRef.current, { type: mime });
    cleanup();

    if (blob.size < 1200) {
      setState({ kind: "error", message: "Aufnahme war zu kurz. Bitte nochmal versuchen." });
      return;
    }

    try {
      setState({ kind: "processing", stage: "Ich transkribiere..." });
      const audioBase64 = await blobToBase64(blob);

      setState({ kind: "processing", stage: "Ich verstehe und fülle aus..." });
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

      const { data, error } = await supabase.functions.invoke("voice-to-form", {
        body: {
          mode,
          today,
          todayWeekday: weekdays[now.getDay()],
          audioBase64,
          audioMime: mime,
          context,
          existingData,
        },
      });

      if (error) throw new Error(error.message || "Anfrage fehlgeschlagen");
      if (!data) throw new Error("Keine Antwort");
      if (data.error) throw new Error(data.error);

      setState({ kind: "idle" });
      onResult(data as VoiceResult);
      toast({
        title: "Sprache verstanden",
        description: data.transcription?.slice(0, 120) ?? "",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fehler bei der Verarbeitung";
      setState({ kind: "error", message });
      toast({ variant: "destructive", title: "Fehler", description: message });
    }
  }, [cleanup, context, existingData, mode, onResult, toast]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* noop */ }
    }
    cleanup();
    setState({ kind: "idle" });
  }, [cleanup]);

  const isBusy = state.kind === "requesting" || state.kind === "processing";
  const isRecording = state.kind === "recording";

  return (
    <Card className={cn(
      "p-3 border-2 border-dashed transition-colors",
      isRecording ? "border-red-500 bg-red-500/5" : "border-primary/40 bg-primary/5",
      compact && "p-2"
    )}>
      <div className="flex items-center gap-3">
        {!isRecording && !isBusy && (
          <Button
            type="button"
            onClick={startRecording}
            className="gap-2"
            size={compact ? "sm" : "default"}
          >
            <Mic className="h-4 w-4" />
            {label}
            <Sparkles className="h-3.5 w-3.5 opacity-70" />
          </Button>
        )}

        {state.kind === "requesting" && (
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Mikrofon-Zugriff...
          </div>
        )}

        {isRecording && (
          <>
            <Button
              type="button"
              variant="destructive"
              onClick={stopRecording}
              className="gap-2 animate-pulse"
              size={compact ? "sm" : "default"}
            >
              <Square className="h-4 w-4 fill-current" />
              Stop ({state.seconds}s)
            </Button>
            <div className="flex-1 flex items-center gap-0.5 h-8">
              {Array.from({ length: 24 }).map((_, i) => {
                const h = Math.max(6, Math.round(state.level * 100 * (0.4 + 0.6 * Math.sin((i + state.seconds) * 0.7))));
                return (
                  <div
                    key={i}
                    className="w-1 bg-red-500 rounded-full transition-all"
                    style={{ height: `${Math.min(100, h)}%` }}
                  />
                );
              })}
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={cancel} title="Abbrechen">
              <X className="h-4 w-4" />
            </Button>
          </>
        )}

        {state.kind === "processing" && (
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> {state.stage}
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="text-sm text-destructive flex-1">{state.message}</div>
            <Button type="button" size="sm" variant="outline" onClick={() => setState({ kind: "idle" })}>
              Erneut
            </Button>
          </div>
        )}
      </div>
      {!isRecording && !isBusy && state.kind !== "error" && (
        <p className="text-xs text-muted-foreground mt-2">
          Sag z.B. „Heute von sieben bis vier auf der Baustelle Müller, Heizungstausch." – die KI füllt alles aus.
        </p>
      )}
    </Card>
  );
};
