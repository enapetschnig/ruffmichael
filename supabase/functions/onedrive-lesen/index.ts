// Nur-Lese-Zugriff auf Michaels OneDrive für Administratoren — z. B. um alte
// Angebote/Rechnungen (KingBill-PDFs) für den Artikel-Import auszulesen.
//
//   GET ?action=suche&q=Rechnung      → PDFs, deren Name/Inhalt zum Suchwort passt
//   GET ?action=ordner&pfad=1 Installateur Ruff/Anbote → Inhalt eines Ordners
//   GET ?action=laden&id=<itemId>     → Dateiinhalt (Bytes)
//
// Es wird NICHTS geschrieben oder gelöscht — die Funktion kennt nur GET-Aufrufe
// an Microsoft Graph. Zugriff nur mit gültigem Administrator-Login.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH = "https://graph.microsoft.com/v1.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function token(): Promise<string> {
  const tenant = Deno.env.get("MS_TENANT_ID")!, clientId = Deno.env.get("MS_CLIENT_ID")!, secret = Deno.env.get("MS_CLIENT_SECRET")!;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Microsoft-Anmeldung fehlgeschlagen: ${data.error_description || JSON.stringify(data)}`);
  return data.access_token;
}

async function graph<T>(tok: string, url: string): Promise<T> {
  const res = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json() as T;
}

type Item = { id: string; name: string; size?: number; lastModifiedDateTime?: string; file?: unknown; folder?: unknown; parentReference?: { path?: string } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = req.headers.get("Authorization") ?? "";
    const { data: { user } } = await createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } }).auth.getUser();
    if (!user) return json({ error: "Nicht angemeldet." }, 401);
    const { data: rolle } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "administrator").maybeSingle();
    if (!rolle) return json({ error: "Nur Administratoren." }, 403);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "suche";
    const tok = await token();
    const target = Deno.env.get("MS_DRIVE_TARGET")!;
    const drive = await graph<{ id: string }>(tok, `/users/${encodeURIComponent(target)}/drive`);
    const d = drive.id;

    if (action === "suche") {
      const q = (url.searchParams.get("q") ?? "pdf").replace(/'/g, "''");
      const treffer: Item[] = [];
      let next: string | null = `${GRAPH}/drives/${d}/root/search(q='${encodeURIComponent(q)}')?$select=id,name,size,lastModifiedDateTime,file,folder,parentReference&$top=200`;
      let seiten = 0;
      while (next && seiten++ < 40) {
        const page = await graph<{ value: Item[]; "@odata.nextLink"?: string }>(tok, next);
        for (const it of page.value) if (it.file && /\.pdf$/i.test(it.name)) treffer.push({ id: it.id, name: it.name, size: it.size, lastModifiedDateTime: it.lastModifiedDateTime, parentReference: { path: it.parentReference?.path } });
        next = page["@odata.nextLink"] ?? null;
      }
      return json({ anzahl: treffer.length, treffer });
    }
    if (action === "ordner") {
      const pfad = url.searchParams.get("pfad") ?? "";
      const enc = pfad.split("/").filter(Boolean).map(encodeURIComponent).join("/");
      const kinder: Item[] = [];
      let next: string | null = pfad ? `${GRAPH}/drives/${d}/root:/${enc}:/children?$top=500&$select=id,name,size,lastModifiedDateTime,file,folder` : `${GRAPH}/drives/${d}/root/children?$top=500&$select=id,name,size,lastModifiedDateTime,file,folder`;
      while (next) { const page = await graph<{ value: Item[]; "@odata.nextLink"?: string }>(tok, next); kinder.push(...page.value.map((it) => ({ id: it.id, name: it.name, size: it.size, lastModifiedDateTime: it.lastModifiedDateTime, file: it.file ? true : undefined, folder: it.folder ? true : undefined }))); next = page["@odata.nextLink"] ?? null; }
      return json({ anzahl: kinder.length, kinder });
    }
    // Alle PDFs unterhalb eines Ordners (Suche über Graph ist mit App-Rechten
    // gesperrt → Ordner für Ordner). Läuft höchstens `zeit` Sekunden und gibt
    // die noch offene Warteschlange zurück; der Aufrufer schickt sie per POST
    // ({ queue }) wieder herein, bis `rest` leer ist — so kein Zeitlimit.
    if (action === "pdfs") {
      const muster = new RegExp(url.searchParams.get("muster") ?? ".", "i");
      const zeit = Number(url.searchParams.get("zeit") ?? 90) * 1000;
      let queue: { id: string; pfad: string }[] = [];
      if (req.method === "POST") {
        try { const body = await req.json(); if (Array.isArray(body?.queue)) queue = body.queue; } catch { /* leer */ }
      }
      if (queue.length === 0) {
        const pfad = url.searchParams.get("pfad") ?? "";
        const enc = pfad.split("/").filter(Boolean).map(encodeURIComponent).join("/");
        const start = pfad ? await graph<Item>(tok, `/drives/${d}/root:/${enc}`) : await graph<Item>(tok, `/drives/${d}/root`);
        queue = [{ id: start.id, pfad }];
      }
      const pdfs: (Item & { pfad: string })[] = [];
      let ordner = 0;
      const t0 = Date.now();
      while (queue.length && Date.now() - t0 < zeit) {
        const cur = queue.shift()!;
        ordner++;
        let next: string | null = `${GRAPH}/drives/${d}/items/${cur.id}/children?$top=500&$select=id,name,size,lastModifiedDateTime,file,folder`;
        while (next) {
          const page = await graph<{ value: Item[]; "@odata.nextLink"?: string }>(tok, next);
          for (const it of page.value) {
            if (it.folder) queue.push({ id: it.id, pfad: `${cur.pfad}/${it.name}` });
            else if (it.file && /\.pdf$/i.test(it.name) && muster.test(it.name)) pdfs.push({ id: it.id, name: it.name, size: it.size, lastModifiedDateTime: it.lastModifiedDateTime, pfad: cur.pfad });
          }
          next = page["@odata.nextLink"] ?? null;
        }
      }
      return json({ anzahl: pdfs.length, ordnerDurchsucht: ordner, rest: queue, pdfs });
    }
    if (action === "laden") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "id fehlt." }, 400);
      const res = await fetch(`${GRAPH}/drives/${d}/items/${id}/content`, { headers: { Authorization: `Bearer ${tok}` } });
      if (!res.ok) return json({ error: `Graph ${res.status}` }, 502);
      return new Response(await res.arrayBuffer(), { headers: { ...corsHeaders, "Content-Type": res.headers.get("content-type") ?? "application/octet-stream" } });
    }
    return json({ error: "Unbekannte Aktion." }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
