/**
 * Gesprochenes zu Text — sonst nichts.
 *
 * Für die Änderungswünsche aus der App: Die Sprachnachricht liegt im
 * Ablagebereich `aenderungswuensche`, diese Funktion holt sie, schreibt sie
 * ab und trägt den Text am Wunsch nach. Der Mensch wartet nicht darauf —
 * er redet, schickt ab, fertig.
 *
 * Zwei Wege hinein:
 *   { wunschId, audioPfad }  → holt die Datei selbst und trägt den Text ein
 *   { audioBase64, audioMime } → schreibt nur ab und gibt den Text zurück
 */

const AI_BASE = Deno.env.get("AI_BASE") ?? "https://api.openai.com/v1";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const STT_MODELL = Deno.env.get("STT_MODELL") ?? "gpt-4o-transcribe";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Der Wortschatz der Schlosserei. Ohne diesen Hinweis macht die Abschrift aus
 * "Feuerverzinken" gern "Feuer verzinken" und aus "Lieferschein" "Liefer
 * Schein" — und aus einem brauchbaren Hinweis wird Kauderwelsch.
 */
const FACHWOERTER = [
  "Feuerverzinken", "Verzinkerei", "Pulverbeschichtung", "Flachstahl",
  "Formrohr", "Rundrohr", "Vierkantrohr", "Blech", "Kantteil", "Abkantung",
  "Schweißnaht", "Heftnaht", "Ausschweißen", "Verschleifen", "Spritzerputzen",
  "Zuschnitt", "Stückliste", "Gitterrost", "Geländer", "Handlauf", "Stiege",
  "Vordach", "Überdachung", "Stützenfuß", "Winkelrahmen", "Schiebetor",
  "Garagentor", "Attika", "Träger", "IPE", "HEA", "HEB", "UNP",
  "Lieferschein", "Angebot", "Eingangsrechnung", "Eingangsangebot",
  "Kundenordner", "Arbeitszeit", "Maschinenstunden", "Hänger-Kilometer",
  "Katalog-Abgleich", "Frankstahl", "Schachermayer", "CS Powermetall",
].join(", ");

function mimeToExt(mime: string): string {
  const clean = mime.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4",
    "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3",
    "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
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

/** Die eigentliche Abschrift bei OpenAI. */
async function abschreiben(datei: Blob, mime: string): Promise<string> {
  const form = new FormData();
  form.append("model", STT_MODELL);
  form.append("file", datei, `aufnahme.${mimeToExt(mime)}`);
  form.append("language", "de");
  form.append(
    "prompt",
    `Sprachnotiz aus einem österreichischen Schlossereibetrieb (CS Powermetall). `
    + `Es geht um einen Änderungswunsch an einer Handwerker-App. `
    + `Gesprochen wird Hochdeutsch mit österreichischem Einschlag — bitte in `
    + `sauberem Hochdeutsch abschreiben, Füllwörter weglassen, Sätze so lassen, `
    + `wie sie gemeint sind. Fachbegriffe: ${FACHWOERTER}`,
  );

  const res = await fetch(`${AI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Abschrift fehlgeschlagen (${res.status}): ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  return String(json.text ?? "").trim();
}

/** Kleiner REST-Helfer — kein SDK nötig für zwei Aufrufe. */
async function wunschSetzen(wunschId: string, felder: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/aenderungswuensche?id=eq.${wunschId}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(felder),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let wunschId: string | undefined;
  try {
    if (!OPENAI_API_KEY) throw new Error("Die Spracherkennung ist nicht eingerichtet.");
    if (!req.headers.get("Authorization")) throw new Error("Nicht angemeldet.");

    const body = await req.json();
    wunschId = typeof body?.wunschId === "string" ? body.wunschId : undefined;

    let datei: Blob;
    let mime: string;

    if (wunschId && typeof body?.audioPfad === "string") {
      // Weg 1: Die Aufnahme liegt schon im Ablagebereich.
      await wunschSetzen(wunschId, { abschrift: "laeuft", abschrift_fehler: null });
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/aenderungswuensche/${body.audioPfad}`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
      );
      if (!res.ok) throw new Error(`Aufnahme nicht lesbar (${res.status})`);
      datei = await res.blob();
      mime = res.headers.get("content-type") || "audio/webm";
    } else if (typeof body?.audioBase64 === "string") {
      // Weg 2: Die Aufnahme kommt direkt mit.
      mime = body.audioMime || "audio/webm";
      datei = base64ToBlob(body.audioBase64, mime);
    } else {
      throw new Error("Keine Aufnahme empfangen.");
    }

    const text = await abschreiben(datei, mime);

    if (wunschId) {
      if (!text) {
        await wunschSetzen(wunschId, {
          abschrift: "fehler",
          abschrift_fehler: "Da war nichts zu verstehen.",
        });
      } else {
        // Getippten Text nicht wegwerfen — die Abschrift kommt darunter.
        const alt = await fetch(
          `${SUPABASE_URL}/rest/v1/aenderungswuensche?id=eq.${wunschId}&select=text`,
          { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
        ).then((r) => r.json()).catch(() => []);
        const vorhanden = String(alt?.[0]?.text ?? "").trim();
        await wunschSetzen(wunschId, {
          text: vorhanden ? `${vorhanden}\n${text}` : text,
          abschrift: "fertig",
          abschrift_fehler: null,
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, text }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
    console.error("sprache-zu-text:", text);
    // Der Wunsch selbst bleibt bestehen — nur die Abschrift ist offen.
    if (wunschId) {
      await wunschSetzen(wunschId, { abschrift: "fehler", abschrift_fehler: text })
        .catch(() => {});
    }
    return new Response(
      JSON.stringify({ success: false, error: text }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
