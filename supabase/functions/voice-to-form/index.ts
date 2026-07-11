// Voice-to-Form Edge Function
// Nimmt Audio + Modus + Kontext, transkribiert per OpenAI STT,
// extrahiert strukturierte Daten per OpenAI und liefert eine
// vorausgefuellte Formularrepraesentation zurueck.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const AI_BASE = "https://api.openai.com/v1";

type Mode = "time" | "disturbance" | "auto" | "uebernahme" | "erstaufnahme" | "assistent";

interface ContextProject { id: string; name: string; plz: string | null; adresse?: string | null; }
interface ContextEmployee { id: string; name: string; }
interface ContextCustomer { id?: string; name: string; email: string | null; adresse: string | null; telefon: string | null; }

interface RequestPayload {
  mode: Mode;
  today: string; // ISO date from client (respects local tz)
  todayWeekday: string; // "Montag" etc.
  audioBase64: string;
  audioMime: string; // e.g. audio/webm, audio/mp4
  context?: {
    projects?: ContextProject[];
    employees?: ContextEmployee[];
    customers?: ContextCustomer[];
    materials?: string[];
    checklist?: string[];
    coreHours?: { start: string; end: string; pauseStart: string; pauseEnd: string };
  };
  existingData?: any; // for append-mode
}

function mimeToExt(mime: string): string {
  const clean = mime.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
  };
  return map[clean] ?? "webm";
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function transcribe(audio: Blob, mime: string): Promise<string> {
  const ext = mimeToExt(mime);
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("file", audio, `recording.${ext}`);
  form.append("language", "de");

  const res = await fetch(`${AI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`STT ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.text ?? "";
}

function buildSystemPrompt(p: RequestPayload): string {
  const projectsList = (p.context?.projects ?? [])
    .map((pr) => `- id=${pr.id} | ${pr.name}${pr.adresse ? ` | ${pr.adresse}` : ""}${pr.plz ? ` (PLZ ${pr.plz})` : ""}`)
    .join("\n") || "(keine)";
  const employeesList = (p.context?.employees ?? [])
    .map((e) => `- id=${e.id} | ${e.name}`).join("\n") || "(keine)";
  const customersList = (p.context?.customers ?? [])
    .slice(0, 50)
    .map((c) => `- ${c.id ? `id=${c.id} | ` : ""}${c.name}${c.telefon ? ` | Tel ${c.telefon}` : ""}${c.email ? ` | ${c.email}` : ""}${c.adresse ? ` | ${c.adresse}` : ""}`)
    .join("\n") || "(keine)";
  const materialsList = (p.context?.materials ?? []).slice(0, 80).join(", ") || "(keine)";

  const checklistList = (p.context?.checklist ?? []).map((c) => `- ${c}`).join("\n") || "(keine)";

  const modeInstructions = p.mode === "disturbance"
    ? `Extrahiere einen REGIEBERICHT (Service-Einsatz beim Kunden).`
    : p.mode === "time"
      ? `Extrahiere ZEITERFASSUNG (Arbeitszeitbloecke oder Abwesenheit).`
      : p.mode === "uebernahme"
        ? `Extrahiere eine UEBERNAHMEBESTAETIGUNG (Abnahme nach Montage). Felder: Auftragsnummer (z.B. "2026 / 45"), zusaetzlich aufgewendete Leistungen, Leistungsverzeichnis bei Regiemontagen, ob eine Bedienungsanleitung uebergeben wurde, Ort und Datum. Kunde/Adresse nur setzen, wenn ausdruecklich genannt.`
        : p.mode === "erstaufnahme"
          ? `Extrahiere eine ERSTAUFNAHME (Vor-Ort-Aufnahme beim Kunden vor Angebotserstellung). Ordne Gesagtes den CHECKLISTEN-PUNKTEN zu (exakter Punkt-Text aus der Liste unten als "item"). Kunde: wenn er in BISHERIGE KUNDEN vorkommt, setze existingCustomerId auf dessen id; sonst fuelle die Kundenfelder. Schlage einen kurzen Projektnamen vor (z.B. "Nachname Waermepumpentausch"). Alles Uebrige in "notizen".`
          : p.mode === "assistent"
            ? `Du bist der Sprachassistent im Dashboard. Erkenne die ABSICHT: "projektnotiz" (der Sprecher will eine Notiz zu einem bestehenden Projekt festhalten - matche das Projekt aus der Liste und setze assistent.projectId + assistent.notiz) ODER "erstaufnahme" (der Sprecher beschreibt einen neuen Kunden/eine Vor-Ort-Aufnahme - fuelle zusaetzlich das erstaufnahme-Objekt wie im Erstaufnahme-Modus). Setze assistent.intent entsprechend.`
            : `Erkenne automatisch, ob es sich um ZEITERFASSUNG oder REGIEBERICHT handelt. Setze das Feld "mode" entsprechend.`;

  return `Du bist ein hochprazisions-Assistent fuer einen oesterreichischen Installateur-Betrieb (Ruff Michael GmbH - Waerme, Kaelte, Regelung).
Du bekommst eine deutsche Sprachnachricht (auch Kaerntner/oesterreichischer Dialekt moeglich) und extrahierst strukturierte Formulardaten.

HEUTE: ${p.today} (${p.todayWeekday})
KERNARBEITSZEIT: ${p.context?.coreHours?.start ?? "07:00"} - ${p.context?.coreHours?.end ?? "16:00"}, Pause ${p.context?.coreHours?.pauseStart ?? "12:00"}-${p.context?.coreHours?.pauseEnd ?? "12:30"}

${modeInstructions}

REGELN ZEITEN:
- "halb acht" = 07:30, "viertel nach neun" = 09:15, "dreiviertel zehn" = 09:45
- "um zwoelfe" / "zwoelf" = 12:00, "sieben Uhr frueh" = 07:00, "sechzehn Uhr dreissig" = 16:30
- Immer Format HH:MM (24h)
- DAUER-MODUS: Wenn nur eine Dauer genannt ist ("zwei Stunden auf Projekt Mueller", "dann drei Stunden Werkstatt"), setze NUR "durationHours" (z.B. 2 oder 3.5), und lasse startTime/endTime LEER. Die App legt die Bloecke dann automatisch sequenziell ab 07:00 an und schiebt eine Pause 12:00-12:30 ein, falls noetig.
- ZEITRAUM-MODUS: Wenn konkrete Uhrzeiten genannt sind ("von sieben bis vier"), setze startTime/endTime und lasse durationHours weg.
- Mischen erlaubt: erster Block Dauer, zweiter Block Uhrzeit.

REGELN DATUM:
- "heute" = ${p.today}
- "gestern" = Tag davor, "vorgestern" = zwei davor
- "am Montag/Dienstag/..." = letzter passender Wochentag <= heute
- "letzten Freitag" = letzter Freitag vor heute
- Format: YYYY-MM-DD

VERFUEGBARE PROJEKTE (nutze exakte id bei Match; Match auch ueber die Adresse moeglich,
z.B. "die Baustelle in der Bahnhofstrasse" oder der Kundenname im Projektnamen):
${projectsList}

VERFUEGBARE MITARBEITER (nutze exakte id bei Match, mit Toleranz fuer Vor-/Spitznamen):
${employeesList}

BISHERIGE KUNDEN (fuer Autofill bei Regiebericht, wenn Name matcht):
${customersList}

BEKANNTE MATERIALIEN (nutze diese Schreibweise wenn passend):
${materialsList}

CHECKLISTEN-PUNKTE (fuer Erstaufnahme; nutze exakt diesen Text als "item"):
${checklistList}

ABWESENHEITSTYPEN: urlaub, krankenstand, weiterbildung, feiertag, za (Zeitausgleich)
LOCATION-TYPEN: baustelle, werkstatt

Bei Unsicherheit: Feld leer/null lassen und in "warnings" eintragen. NIE erfinden.
Bei Widerspruechen (Endzeit vor Startzeit etc.) in "warnings" vermerken.`;
}

const uebernahmeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    auftragNr: { type: "string", description: "z.B. 2026 / 45, sonst leer" },
    zusatzLeistungen: { type: "string" },
    leistungsverzeichnis: { type: "string" },
    bedienungsanleitung: { type: "boolean" },
    ort: { type: "string" },
    datum: { type: "string", description: "YYYY-MM-DD oder leer" },
    kundeName: { type: "string" },
    strasse: { type: "string" },
    plzOrt: { type: "string" },
  },
  required: ["auftragNr", "zusatzLeistungen", "leistungsverzeichnis", "bedienungsanleitung", "ort", "datum", "kundeName", "strasse", "plzOrt"],
};

const erstaufnahmeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    existingCustomerId: { type: "string", description: "id aus BISHERIGE KUNDEN bei Match, sonst leer" },
    kunde: {
      type: "object",
      additionalProperties: false,
      properties: {
        vorname: { type: "string" },
        nachname: { type: "string" },
        strasse: { type: "string" },
        ort: { type: "string" },
        telefon: { type: "string" },
        email: { type: "string" },
      },
      required: ["vorname", "nachname", "strasse", "ort", "telefon", "email"],
    },
    projektName: { type: "string", description: "kurzer Vorschlag, z.B. Nachname Waermepumpe" },
    notizen: { type: "string" },
    checklist: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          item: { type: "string", description: "exakter Text aus CHECKLISTEN-PUNKTE" },
          bemerkung: { type: "string" },
          erledigt: { type: "boolean" },
        },
        required: ["item", "bemerkung", "erledigt"],
      },
    },
  },
  required: ["existingCustomerId", "kunde", "projektName", "notizen", "checklist"],
};

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["time", "disturbance", "uebernahme", "erstaufnahme", "assistent"] },
    // ZEITERFASSUNG
    time: {
      type: "object",
      additionalProperties: false,
      properties: {
        date: { type: "string", description: "YYYY-MM-DD oder leer" },
        blocks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              locationType: { type: "string", enum: ["baustelle", "werkstatt", ""] },
              projectId: { type: "string", description: "id aus Projekte-Liste oder leer" },
              projectNameGuess: { type: "string", description: "Rohname falls kein match" },
              taetigkeit: { type: "string" },
              startTime: { type: "string" },
              endTime: { type: "string" },
              durationHours: { type: "number", description: "Alternative zu startTime/endTime: Dauer in Stunden (z.B. 2 oder 3.5). 0 wenn nicht anwendbar." },
              pauseStart: { type: "string" },
              pauseEnd: { type: "string" },
              employeeIds: { type: "array", items: { type: "string" } },
            },
            required: ["locationType", "projectId", "projectNameGuess", "taetigkeit", "startTime", "endTime", "durationHours", "pauseStart", "pauseEnd", "employeeIds"],
          },
        },
        absence: {
          type: "object",
          additionalProperties: false,
          properties: {
            isAbsence: { type: "boolean" },
            type: { type: "string", enum: ["urlaub", "krankenstand", "weiterbildung", "feiertag", "za", ""] },
            isFullDay: { type: "boolean" },
            startTime: { type: "string" },
            endTime: { type: "string" },
            pauseMinutes: { type: "number" },
          },
          required: ["isAbsence", "type", "isFullDay", "startTime", "endTime", "pauseMinutes"],
        },
      },
      required: ["date", "blocks", "absence"],
    },
    // REGIEBERICHT
    disturbance: {
      type: "object",
      additionalProperties: false,
      properties: {
        date: { type: "string" },
        startTime: { type: "string" },
        endTime: { type: "string" },
        pauseMinutes: { type: "number" },
        kundeName: { type: "string" },
        kundeEmail: { type: "string" },
        kundeAdresse: { type: "string" },
        kundeTelefon: { type: "string" },
        beschreibung: { type: "string" },
        notizen: { type: "string" },
        employeeIds: { type: "array", items: { type: "string" } },
        materials: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              material: { type: "string" },
              menge: { type: "string" },
            },
            required: ["material", "menge"],
          },
        },
      },
      required: ["date", "startTime", "endTime", "pauseMinutes", "kundeName", "kundeEmail", "kundeAdresse", "kundeTelefon", "beschreibung", "notizen", "employeeIds", "materials"],
    },
    // UEBERNAHMEBESTAETIGUNG
    uebernahme: uebernahmeSchema,
    // ERSTAUFNAHME
    erstaufnahme: erstaufnahmeSchema,
    // SPRACHASSISTENT (Dashboard)
    assistent: {
      type: "object",
      additionalProperties: false,
      properties: {
        intent: { type: "string", enum: ["projektnotiz", "erstaufnahme", ""] },
        projectId: { type: "string", description: "id aus Projekte-Liste bei projektnotiz, sonst leer" },
        notiz: { type: "string" },
      },
      required: ["intent", "projectId", "notiz"],
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["mode", "time", "disturbance", "uebernahme", "erstaufnahme", "assistent", "warnings"],
};

async function extract(transcription: string, payload: RequestPayload) {
  const system = buildSystemPrompt(payload);
  const userMsg = `TRANSKRIPTION:\n"""${transcription}"""\n\n${payload.existingData ? `BESTEHENDE DATEN (fuer Ergaenzungsmodus, nicht ueberschreiben wenn Sprache nichts Neues sagt):\n${JSON.stringify(payload.existingData)}\n\n` : ""}Gib das Ergebnis als JSON gemaess Schema zurueck.`;

  const res = await fetch(`${AI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "voice_extraction", strict: true, schema: extractionSchema },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${text}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Keine Extraktion erhalten");
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("Extraktion war kein gueltiges JSON");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }
  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY fehlt" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = (await req.json()) as RequestPayload;
    if (!payload?.audioBase64) {
      return new Response(JSON.stringify({ error: "audioBase64 fehlt" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blob = base64ToBlob(payload.audioBase64, payload.audioMime || "audio/webm");
    if (blob.size < 800) {
      return new Response(JSON.stringify({ error: "Aufnahme zu kurz oder leer. Bitte nochmal versuchen." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transcription = await transcribe(blob, payload.audioMime || "audio/webm");
    if (!transcription.trim()) {
      return new Response(JSON.stringify({ error: "Keine Sprache erkannt.", transcription: "" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extracted = await extract(transcription, payload);

    return new Response(JSON.stringify({ transcription, extracted }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("voice-to-form error", msg);
    const status = /429/.test(msg) ? 429 : /402/.test(msg) ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
