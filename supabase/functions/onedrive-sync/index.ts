// Zwei-Wege-Synchronisation der Projektordner mit OneDrive/SharePoint
// (Microsoft 365 Firmenkonto, App-Only via Microsoft Graph).
//
// Abgeglichen wird pro Projekt:
//   project-files/{id}/**            <->  {Root}/{Projektname}/**
//   project-photos/{id}/*            <->  {Root}/{Projektname}/Fotos/*
//   project-plans/{id}/*             <->  {Root}/{Projektname}/Plan/*
//   project-reports/{id}/*           <->  {Root}/{Projektname}/Regieberichte/*
//   project-materials/{id}/*         <->  {Root}/{Projektname}/Material/*
// BEWUSST NICHT synchronisiert: project-chef (vertraulich, nur Admin).
//
// Zwei-Wege-Logik: Die Tabelle onedrive_sync_state merkt sich den Stand beider
// Seiten beim letzten Abgleich. Nur echte Änderungen werden kopiert (kein
// Ping-Pong); bei Änderung auf beiden Seiten gewinnt die neuere Datei.
// Löschungen werden in V1 NICHT übertragen: eine gelöschte Datei wird aber
// auch nicht wiederhergestellt.
//
// Secrets (Function-Secrets): MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET,
// MS_DRIVE_TARGET (E-Mail/UPN des OneDrive-Kontos ODER SharePoint-Site-URL),
// optional ONEDRIVE_ROOT (Standard: "Ruff Michael Projekte").
//
// Aufrufe:  ?action=test  -> Verbindungstest (Token, Laufwerk, Root-Ordner)
//           ?action=sync  -> Abgleich (Standard; auch per Cron alle 10 Min)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.microsoft.com/v1.0";
const ROOT_NAME = Deno.env.get("ONEDRIVE_ROOT") || "Ruff Michael Projekte";
// Feste Kategorie-Ordner <-> Buckets (Chef fehlt absichtlich)
const CATEGORY_BUCKETS: Record<string, string> = {
  "Fotos": "project-photos",
  "Plan": "project-plans",
  "Plaene": "project-plans",
  "Pläne": "project-plans",
  "Regieberichte": "project-reports",
  "Material": "project-materials",
};
// Ordnernamen exakt so, wie Michael Ruff sie in OneDrive führt (ausgezählt über
// 44 echte Projektordner): "Fotos" (Mehrzahl) und "Plan" (Einzahl).
const CATEGORY_REMOTE_NAME: Record<string, string> = {
  "project-photos": "Fotos",
  "project-plans": "Plan",
  "project-reports": "Regieberichte",
  "project-materials": "Material",
};
const SKEW_MS = 5000;          // Toleranz gegen Uhren-/Metadaten-Schwankung
const MAX_TRANSFERS = 200;     // pro Lauf; Rest übernimmt der nächste Cron-Lauf
const TIME_BUDGET_MS = 110_000;
const MAX_FILE_BYTES = 45 * 1024 * 1024; // Storage-Bucket-Limit (50 MB) mit Puffer
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
const CHUNK = 327_680 * 16; // 5 MiB, Vielfaches von 320 KiB (Graph-Vorgabe)

// Umlaute/Sonderzeichen -> gültiger Supabase-Storage-Key (wie im Frontend)
const toStorageKey = (name: string) =>
  name
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9._ ()-]/g, "_");

// OneDrive-verbotene Zeichen aus Ordnernamen entfernen
const toDriveName = (name: string) =>
  name.replace(/[\\/:*?"<>|#%]/g, "_").replace(/^[ .]+|[ .]+$/g, "").slice(0, 120) || "Projekt";

type GraphItem = {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: unknown;
  file?: { mimeType?: string };
};

class Graph {
  constructor(private token: string) {}
  async req(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${GRAPH}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.body && !(init.body instanceof ArrayBuffer) && !(init.body instanceof Uint8Array)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init.headers || {}),
      },
    });
    return res;
  }
  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.req(path, init);
    if (!res.ok) throw new Error(`Graph ${init.method || "GET"} ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }
  // Alle Kind-Elemente eines Ordners (mit Paging)
  async children(driveId: string, itemId: string): Promise<GraphItem[]> {
    const out: GraphItem[] = [];
    let url: string | null = `${GRAPH}/drives/${driveId}/items/${itemId}/children?$top=500&$select=id,name,size,lastModifiedDateTime,folder,file`;
    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!res.ok) throw new Error(`Graph children: ${res.status} ${await res.text()}`);
      const data = await res.json();
      out.push(...(data.value ?? []));
      url = data["@odata.nextLink"] ?? null;
    }
    return out;
  }
  // Ordner anlegen (oder vorhandenen zurückgeben)
  async ensureFolder(driveId: string, parentId: string, name: string): Promise<GraphItem> {
    const res = await this.req(`/drives/${driveId}/items/${parentId}/children`, {
      method: "POST",
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
    if (res.ok) return (await res.json()) as GraphItem;
    if (res.status === 409) {
      // existiert schon -> per Pfad relativ zum Parent holen
      return await this.json<GraphItem>(
        `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}`,
      );
    }
    throw new Error(`Ordner "${name}": ${res.status} ${await res.text()}`);
  }
  async upload(driveId: string, parentId: string, name: string, data: ArrayBuffer, mime?: string): Promise<GraphItem> {
    if (data.byteLength <= SIMPLE_UPLOAD_LIMIT) {
      const res = await this.req(
        `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=replace`,
        { method: "PUT", body: data, headers: { "Content-Type": mime || "application/octet-stream" } },
      );
      if (!res.ok) throw new Error(`Upload ${name}: ${res.status} ${await res.text()}`);
      return (await res.json()) as GraphItem;
    }
    // Große Dateien: Upload-Session in 5-MiB-Blöcken
    const session = await this.json<{ uploadUrl: string }>(
      `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}:/createUploadSession`,
      { method: "POST", body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }) },
    );
    const total = data.byteLength;
    let offset = 0;
    let last: GraphItem | null = null;
    while (offset < total) {
      const end = Math.min(offset + CHUNK, total);
      const res = await fetch(session.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(end - offset),
          "Content-Range": `bytes ${offset}-${end - 1}/${total}`,
        },
        body: data.slice(offset, end),
      });
      if (!res.ok && res.status !== 202) throw new Error(`Chunk-Upload ${name}: ${res.status} ${await res.text()}`);
      if (res.status === 200 || res.status === 201) last = (await res.json()) as GraphItem;
      offset = end;
    }
    if (!last) throw new Error(`Upload-Session ${name}: kein Abschluss-Item`);
    return last;
  }
  async download(driveId: string, itemId: string): Promise<ArrayBuffer> {
    const res = await this.req(`/drives/${driveId}/items/${itemId}/content`);
    if (!res.ok) throw new Error(`Download: ${res.status} ${await res.text()}`);
    return await res.arrayBuffer();
  }
}

async function getToken(tenant: string, clientId: string, secret: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Microsoft-Anmeldung fehlgeschlagen: ${data.error_description || JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

// Ziel-Laufwerk auflösen: SharePoint-Site-URL oder E-Mail/UPN eines Nutzers
async function resolveDrive(g: Graph, target: string): Promise<{ driveId: string; owner: string }> {
  if (target.startsWith("http")) {
    const u = new URL(target);
    const site = await g.json<{ id: string; displayName: string }>(
      `/sites/${u.hostname}:${u.pathname.replace(/\/$/, "")}`,
    );
    const drive = await g.json<{ id: string }>(`/sites/${site.id}/drive`);
    return { driveId: drive.id, owner: `SharePoint: ${site.displayName}` };
  }
  const drive = await g.json<{ id: string; owner?: { user?: { displayName?: string } } }>(
    `/users/${encodeURIComponent(target)}/drive`,
  );
  return { driveId: drive.id, owner: `OneDrive: ${drive.owner?.user?.displayName ?? target}` };
}

// ---- Storage-Helfer -------------------------------------------------------

type SupaFile = { rel: string; size: number; updated: string };

// deno-lint-ignore no-explicit-any
async function listTree(supa: any, bucket: string, base: string, prefix = ""): Promise<{ files: SupaFile[]; folders: string[] }> {
  const files: SupaFile[] = [];
  const folders: string[] = [];
  const path = prefix ? `${base}/${prefix}` : base;
  const { data, error } = await supa.storage.from(bucket).list(path, { limit: 1000 });
  if (error) throw new Error(`Storage list ${bucket}/${path}: ${error.message}`);
  for (const item of data ?? []) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      folders.push(rel);
      const sub = await listTree(supa, bucket, base, rel);
      files.push(...sub.files);
      folders.push(...sub.folders);
    } else if (item.name !== ".keep" && item.name !== ".emptyFolderPlaceholder") {
      files.push({ rel, size: item.metadata?.size ?? 0, updated: item.updated_at ?? item.created_at });
    }
  }
  return { files, folders };
}

// deno-lint-ignore no-explicit-any
async function freshUpdated(supa: any, bucket: string, fullPath: string): Promise<string> {
  const dir = fullPath.split("/").slice(0, -1).join("/");
  const name = fullPath.split("/").pop()!;
  const { data } = await supa.storage.from(bucket).list(dir, { limit: 1000, search: name });
  const hit = (data ?? []).find((f: { name: string }) => f.name === name);
  return hit?.updated_at ?? new Date().toISOString();
}

// ---- Remote-Baum ----------------------------------------------------------

type RemoteFile = { rel: string; id: string; name: string; size: number; modified: string };

async function remoteTree(
  g: Graph, driveId: string, folderId: string, prefix = "",
): Promise<{ files: RemoteFile[]; folders: { rel: string; id: string }[] }> {
  const files: RemoteFile[] = [];
  const folders: { rel: string; id: string }[] = [];
  for (const item of await g.children(driveId, folderId)) {
    const relName = toStorageKey(item.name);
    const rel = prefix ? `${prefix}/${relName}` : relName;
    if (item.folder) {
      folders.push({ rel, id: item.id });
      const sub = await remoteTree(g, driveId, item.id, rel);
      files.push(...sub.files);
      folders.push(...sub.folders);
    } else {
      files.push({
        rel, id: item.id, name: item.name,
        size: item.size ?? 0,
        modified: item.lastModifiedDateTime ?? new Date(0).toISOString(),
      });
    }
  }
  return { files, folders };
}

// Remote-Unterordner entlang eines rel-Pfads sicherstellen (mit Cache)
async function ensurePath(
  g: Graph, driveId: string, rootId: string, rel: string, cache: Map<string, string>,
): Promise<string> {
  if (!rel) return rootId;
  if (cache.has(rel)) return cache.get(rel)!;
  const parentRel = rel.split("/").slice(0, -1).join("/");
  const name = rel.split("/").pop()!;
  const parentId = await ensurePath(g, driveId, rootId, parentRel, cache);
  const folder = await g.ensureFolder(driveId, parentId, name);
  cache.set(rel, folder.id);
  return folder.id;
}

// ---- Hauptlogik -----------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "sync";

  const tenant = Deno.env.get("MS_TENANT_ID");
  const clientId = Deno.env.get("MS_CLIENT_ID");
  const secret = Deno.env.get("MS_CLIENT_SECRET");
  const target = Deno.env.get("MS_DRIVE_TARGET");

  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (!tenant || !clientId || !secret || !target) {
    return reply({
      ok: false,
      configured: false,
      message:
        "OneDrive-Sync noch nicht konfiguriert. Es fehlen: " +
        [!tenant && "MS_TENANT_ID", !clientId && "MS_CLIENT_ID", !secret && "MS_CLIENT_SECRET", !target && "MS_DRIVE_TARGET"]
          .filter(Boolean).join(", "),
    });
  }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Optional: nur EIN Projekt synchronisieren (Sofort-Ordner nach Projekt-Anlage).
  let onlyProjectId = url.searchParams.get("projectId");
  if (!onlyProjectId && req.method === "POST") {
    try {
      const b = await req.json();
      if (b && typeof b.projectId === "string") onlyProjectId = b.projectId;
    } catch { /* leerer/kein JSON-Body (z.B. Cron) */ }
  }

  try {
    const token = await getToken(tenant, clientId, secret);
    const g = new Graph(token);
    const { driveId, owner } = await resolveDrive(g, target);
    // Root darf ein VERSCHACHTELTER Pfad sein (z.B. "1 Installateur Ruff/1 Kunde
    // in Arbeit/1 Arbeit 2026") – Segmente einzeln encodieren; fehlende Teile
    // werden segmentweise angelegt.
    const encPath = (p: string) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const rootItem = await (async () => {
      const res = await g.req(`/drives/${driveId}/root:/${encPath(ROOT_NAME)}`);
      if (res.ok) return (await res.json()) as GraphItem;
      let cur = await g.json<GraphItem>(`/drives/${driveId}/root`);
      for (const seg of ROOT_NAME.split("/").filter(Boolean)) {
        cur = await g.ensureFolder(driveId, cur.id, seg);
      }
      return cur;
    })();

    if (action === "test") {
      return reply({ ok: true, configured: true, ziel: owner, rootOrdner: ROOT_NAME, rootId: rootItem.id });
    }

    // ---- SYNC ----
    const stats = { hochgeladen: 0, heruntergeladen: 0, ordnerAngelegt: 0, uebersprungen: 0, fehler: [] as string[] };
    let transfers = 0;
    let partial = false;
    const outOfBudget = () => Date.now() - started > TIME_BUDGET_MS || transfers >= MAX_TRANSFERS;

    let projQuery = supa
      .from("projects")
      .select("id, name, onedrive_folder_id")
      .order("created_at");
    if (onlyProjectId) projQuery = projQuery.eq("id", onlyProjectId);
    const { data: projects, error: projErr } = await projQuery;
    if (projErr) throw new Error(projErr.message);

    for (const project of projects ?? []) {
      if (outOfBudget()) { partial = true; break; }
      try {
        // Projektordner in OneDrive sicherstellen (per gespeicherter ID, sonst anlegen)
        let folderId = project.onedrive_folder_id as string | null;
        if (folderId) {
          const check = await g.req(`/drives/${driveId}/items/${folderId}`);
          if (!check.ok) folderId = null; // wurde remote gelöscht -> neu anlegen
        }
        if (!folderId) {
          let name = toDriveName(project.name);
          let created: GraphItem;
          try {
            created = await g.ensureFolder(driveId, rootItem.id, name);
          } catch {
            name = `${name} (${String(project.id).slice(0, 8)})`;
            created = await g.ensureFolder(driveId, rootItem.id, name);
          }
          folderId = created.id;
          stats.ordnerAngelegt++;
          await supa.from("projects").update({ onedrive_folder_id: folderId }).eq("id", project.id);
        }

        // Sync-Zustand des Projekts laden
        const { data: stateRows } = await supa
          .from("onedrive_sync_state").select("*").eq("project_id", project.id);
        const state = new Map<string, { supa_updated: string | null; od_modified: string | null; od_item_id: string | null }>();
        for (const r of stateRows ?? []) state.set(`${r.bucket}|${r.rel_path}`, r);

        const saveState = async (bucket: string, rel: string, supaUpd: string | null, odMod: string | null, odId: string | null) => {
          await supa.from("onedrive_sync_state").upsert({
            bucket, project_id: project.id, rel_path: rel,
            supa_updated: supaUpd, od_modified: odMod, od_item_id: odId,
            last_synced: new Date().toISOString(),
          });
        };

        // Remote-Baum des Projektordners einlesen
        const remote = await remoteTree(g, driveId, folderId);
        const remoteByBucket = new Map<string, Map<string, RemoteFile>>();
        const remoteFolderIds = new Map<string, string>(); // rel (project-files-Sicht) -> item id
        for (const f of remote.folders) {
          const top = f.rel.split("/")[0];
          if (!(top in CATEGORY_BUCKETS)) remoteFolderIds.set(f.rel, f.id);
        }
        const put = (bucket: string, rel: string, f: RemoteFile) => {
          if (!remoteByBucket.has(bucket)) remoteByBucket.set(bucket, new Map());
          remoteByBucket.get(bucket)!.set(rel, f);
        };
        for (const f of remote.files) {
          const [top, ...rest] = f.rel.split("/");
          if (top in CATEGORY_BUCKETS && rest.length > 0) {
            put(CATEGORY_BUCKETS[top], rest.join("/"), f);
          } else {
            put("project-files", f.rel, f);
          }
        }

        // App-Seite einlesen
        const appByBucket = new Map<string, Map<string, SupaFile>>();
        const pf = await listTree(supa, "project-files", project.id);
        appByBucket.set("project-files", new Map(pf.files.map((f) => [f.rel, f])));
        for (const bucket of Object.keys(CATEGORY_REMOTE_NAME)) {
          const { data } = await supa.storage.from(bucket).list(project.id, { limit: 1000 });
          appByBucket.set(bucket, new Map(
            (data ?? [])
              .filter((i: { id: string | null; name: string }) => i.id !== null && i.name !== ".keep")
              // deno-lint-ignore no-explicit-any
              .map((i: any) => [i.name, { rel: i.name, size: i.metadata?.size ?? 0, updated: i.updated_at ?? i.created_at }]),
          ));
        }

        const folderCache = new Map<string, string>();
        // Kategorie-Ordnernamen im Cache vorbelegen, damit ensurePath sie nutzt
        for (const [rel, id] of remoteFolderIds) folderCache.set(rel, id);

        const newer = (a: string | null | undefined, b: string | null | undefined) =>
          new Date(a ?? 0).getTime() > new Date(b ?? 0).getTime() + SKEW_MS;

        for (const [bucket, appFiles] of appByBucket) {
          const remoteFiles = remoteByBucket.get(bucket) ?? new Map<string, RemoteFile>();
          const allRels = new Set<string>([...appFiles.keys(), ...remoteFiles.keys()]);
          for (const rel of allRels) {
            if (outOfBudget()) { partial = true; break; }
            const app = appFiles.get(rel);
            const rem = remoteFiles.get(rel);
            const st = state.get(`${bucket}|${rel}`);
            const appPath = `${project.id}/${rel}`;
            // Ziel-Pfad in OneDrive (Kategorie-Buckets liegen unter ihrem Ordnernamen)
            const remoteRel = bucket === "project-files" ? rel : `${CATEGORY_REMOTE_NAME[bucket]}/${rel}`;

            try {
              if (app && !rem) {
                if (st?.od_item_id) { stats.uebersprungen++; continue; } // remote gelöscht -> nicht wiederherstellen
                if (app.size > MAX_FILE_BYTES) { stats.uebersprungen++; continue; }
                const { data: blob, error } = await supa.storage.from(bucket).download(appPath);
                if (error) throw new Error(error.message);
                const parentRel = remoteRel.split("/").slice(0, -1).join("/");
                const parentId = await ensurePath(g, driveId, folderId, parentRel, folderCache);
                const item = await g.upload(driveId, parentId, rel.split("/").pop()!, await blob.arrayBuffer(), blob.type);
                await saveState(bucket, rel, app.updated, item.lastModifiedDateTime ?? null, item.id);
                stats.hochgeladen++; transfers++;
              } else if (!app && rem) {
                if (st) { stats.uebersprungen++; continue; } // in der App gelöscht -> nicht wiederherstellen
                if (rem.size > MAX_FILE_BYTES) { stats.uebersprungen++; continue; }
                const buf = await g.download(driveId, rem.id);
                const { error } = await supa.storage.from(bucket)
                  .upload(appPath, new Blob([buf]), { upsert: true });
                if (error) throw new Error(error.message);
                const upd = await freshUpdated(supa, bucket, appPath);
                await saveState(bucket, rel, upd, rem.modified, rem.id);
                stats.heruntergeladen++; transfers++;
              } else if (app && rem) {
                const appChanged = !st || newer(app.updated, st.supa_updated);
                const remChanged = !st || newer(rem.modified, st.od_modified);
                if (appChanged && (!remChanged || newer(app.updated, rem.modified))) {
                  if (app.size > MAX_FILE_BYTES) { stats.uebersprungen++; continue; }
                  const { data: blob, error } = await supa.storage.from(bucket).download(appPath);
                  if (error) throw new Error(error.message);
                  const parentRel = remoteRel.split("/").slice(0, -1).join("/");
                  const parentId = await ensurePath(g, driveId, folderId, parentRel, folderCache);
                  const item = await g.upload(driveId, parentId, rel.split("/").pop()!, await blob.arrayBuffer(), blob.type);
                  await saveState(bucket, rel, app.updated, item.lastModifiedDateTime ?? null, item.id);
                  stats.hochgeladen++; transfers++;
                } else if (remChanged && newer(rem.modified, st?.supa_updated ? app.updated : null)) {
                  if (rem.size > MAX_FILE_BYTES) { stats.uebersprungen++; continue; }
                  const buf = await g.download(driveId, rem.id);
                  const { error } = await supa.storage.from(bucket)
                    .upload(appPath, new Blob([buf]), { upsert: true });
                  if (error) throw new Error(error.message);
                  const upd = await freshUpdated(supa, bucket, appPath);
                  await saveState(bucket, rel, upd, rem.modified, rem.id);
                  stats.heruntergeladen++; transfers++;
                } else if (!st) {
                  // beide vorhanden, keine Seite eindeutig neuer -> Zustand einfrieren
                  await saveState(bucket, rel, app.updated, rem.modified, rem.id);
                }
              }
            } catch (e) {
              stats.fehler.push(`${project.name}/${bucket}/${rel}: ${e instanceof Error ? e.message : e}`);
            }
          }
        }

        // Leere App-Ordner (nur .keep) auch in OneDrive anlegen …
        for (const folderRel of pf.folders) {
          if (outOfBudget()) { partial = true; break; }
          if (!remoteFolderIds.has(folderRel)) {
            await ensurePath(g, driveId, folderId, folderRel, folderCache);
            stats.ordnerAngelegt++;
          }
        }
        // … und neue OneDrive-Ordner in der App sichtbar machen (.keep-Platzhalter)
        for (const [folderRel] of remoteFolderIds) {
          if (outOfBudget()) { partial = true; break; }
          const seg = folderRel.split("/")[0];
          if (seg in CATEGORY_BUCKETS) continue;
          const anyApp = pf.folders.includes(folderRel);
          if (!anyApp) {
            await supa.storage.from("project-files")
              .upload(`${project.id}/${folderRel}/.keep`, new Blob([""]), { upsert: true });
            stats.ordnerAngelegt++;
          }
        }
      } catch (e) {
        stats.fehler.push(`Projekt ${project.name}: ${e instanceof Error ? e.message : e}`);
      }
    }

    return reply({ ok: stats.fehler.length === 0, configured: true, ziel: owner, partial, ...stats });
  } catch (e) {
    return reply({ ok: false, configured: true, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
