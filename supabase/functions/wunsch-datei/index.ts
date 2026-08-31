/**
 * Signierte URL für eine Wunsch-Datei — nur fürs CRM.
 *
 * Bildschirmfotos und Sprachnachrichten liegen im privaten Bucket
 * `aenderungswuensche`. Das CRM hat bewusst KEINE Supabase-Schlüssel dieser
 * App; wenn es eine Datei zeigen will, fragt es hier an — mit demselben
 * Geheimnis, mit dem die App ihre Wünsche schickt (COCKPIT_SECRET).
 *
 *   POST { pfad: "<uid>/123-bild.jpg" }  →  { url: "<signierte URL, 1 h>" }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cockpit-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const erwartet = Deno.env.get("COCKPIT_SECRET");
  if (!erwartet || req.headers.get("x-cockpit-secret") !== erwartet) {
    return new Response(JSON.stringify({ error: "Nicht erlaubt." }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const { pfad } = await req.json();
    // Nur echte Bucket-Pfade (uid/dateiname) — nichts Konstruiertes.
    if (typeof pfad !== "string" || !/^[0-9a-f-]{36}\/[\w.-]+$/i.test(pfad)) {
      throw new Error("Ungültiger Pfad.");
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase.storage
      .from("aenderungswuensche")
      .createSignedUrl(pfad, 3600);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || "Signieren fehlgeschlagen.");
    }
    return new Response(JSON.stringify({ url: data.signedUrl }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
