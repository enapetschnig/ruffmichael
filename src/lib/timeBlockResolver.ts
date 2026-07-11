// Loest eine Liste von Zeitbloecken auf konkrete Start/End-Zeiten auf.
// - Bloecke koennen entweder explizite startTime/endTime haben ODER durationHours.
// - Sequenzielle Bloecke ohne startTime beginnen am Cursor (Anker = 07:00 oder das Ende des letzten Blocks).
// - Wenn ein Block das Pausenfenster (Default 12:00-12:30) ueberdeckt,
//   wird er in zwei saubere Bloecke gesplittet (Vormittag bis 12:00, Nachmittag ab 12:30),
//   damit die Pause als echte Luecke sichtbar ist und die Arbeitszeit erhalten bleibt.

export interface RawBlock {
  startTime?: string;
  endTime?: string;
  durationHours?: number;
  pauseStart?: string;
  pauseEnd?: string;
  [key: string]: any;
}

export interface ResolvedBlock extends RawBlock {
  startTime: string;
  endTime: string;
  pauseStart: string;
  pauseEnd: string;
  autoPause?: boolean;
  splitFromPause?: boolean;
}

export interface ResolveOptions {
  anchor?: string; // HH:MM
  pauseWindow?: { start: string; end: string };
}

const HHMM = /^\d{2}:\d{2}$/;

const toMin = (s?: string): number | null => {
  if (!s || !HHMM.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

const toHHMM = (min: number): string => {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

export function resolveTimeBlocks<T extends RawBlock>(
  blocks: T[],
  options: ResolveOptions = {},
): { blocks: (T & ResolvedBlock)[]; suggestions: string[] } {
  const anchor = toMin(options.anchor) ?? 7 * 60;
  const pauseStartMin = toMin(options.pauseWindow?.start) ?? 12 * 60;
  const pauseEndMin = toMin(options.pauseWindow?.end) ?? 12 * 60 + 30;
  const pauseLen = Math.max(0, pauseEndMin - pauseStartMin);

  const suggestions: string[] = [];
  let cursor = anchor;
  const out: (T & ResolvedBlock)[] = [];

  blocks.forEach((raw, idx) => {
    let start = toMin(raw.startTime);
    let end = toMin(raw.endTime);
    const duration = typeof raw.durationHours === "number" && raw.durationHours > 0
      ? Math.round(raw.durationHours * 60)
      : null;

    if (start == null) start = cursor;
    if (end == null && duration != null) end = start + duration;
    if (end == null) end = start + 60;

    const explicitPause = toMin(raw.pauseStart) != null || toMin(raw.pauseEnd) != null;

    // Splitting-Regel: Block ueberdeckt die Mittagspause und hat keine eigene Pause?
    // -> in zwei Bloecke aufteilen; Nachmittagsteil startet nach der Pause.
    if (!explicitPause && pauseLen > 0 && start < pauseStartMin && end > pauseStartMin) {
      const totalWork = end - start;
      const morningEnd = pauseStartMin;
      const morningWork = morningEnd - start;
      const afternoonStart = pauseEndMin;
      const afternoonWork = totalWork - morningWork;
      const afternoonEnd = afternoonStart + afternoonWork;

      const morning: T & ResolvedBlock = {
        ...raw,
        startTime: toHHMM(start),
        endTime: toHHMM(morningEnd),
        pauseStart: "",
        pauseEnd: "",
        autoPause: true,
        splitFromPause: true,
      };
      const afternoon: T & ResolvedBlock = {
        ...raw,
        startTime: toHHMM(afternoonStart),
        endTime: toHHMM(afternoonEnd),
        pauseStart: "",
        pauseEnd: "",
        autoPause: true,
        splitFromPause: true,
      };
      out.push(morning, afternoon);
      cursor = afternoonEnd;
      suggestions.push(`Block ${idx + 1}: Mittagspause 12:00-12:30 automatisch eingefuegt (in 2 Bloecke gesplittet).`);
      return;
    }

    const ps = toMin(raw.pauseStart);
    const pe = toMin(raw.pauseEnd);

    const resolved: T & ResolvedBlock = {
      ...raw,
      startTime: toHHMM(start),
      endTime: toHHMM(end),
      pauseStart: ps != null ? toHHMM(ps) : "",
      pauseEnd: pe != null ? toHHMM(pe) : "",
      autoPause: false,
    };
    out.push(resolved);
    cursor = end;
  });

  return { blocks: out, suggestions };
}
