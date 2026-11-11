import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { expect, type Page } from "@playwright/test";
import { funktionsPort } from "./funktionen";

// Gemeinsamer Baustein der Grundtests. Sie laufen gegen die Testumgebung mit anonymisierten Echtdaten
// (testumgebung.mjs start + daten). Darum steht hier und in den Tests kein Wert aus den Daten: Konten werden zur
// Laufzeit gesucht, eigene Testdaten tragen die Marke »Grundtest« und werden per ID wieder gelöscht
// (CLAUDE.md: Löschen nur per expliziter ID).

export const API = process.env.TEST_API_URL ?? "";
export const APP = process.env.TEST_APP_URL ?? "";
export const ANON = process.env.TEST_ANON_KEY ?? "";
const SERVICE = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const DB_CONTAINER = process.env.TEST_DB_CONTAINER ?? "supabase_db_pf-ruffmichael";

/** Passwort, das testumgebung.mjs den Konten der anonymisierten Benutzer gibt – nur in der Testumgebung gültig. */
const DATEN_PASSWORT = "Test1234!";

// Zweite Sicherung neben playwright.config.ts: Auch wer die Tests anders startet, kommt nicht an die echte Datenbank.
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(API)) {
  throw new Error("Grundtests laufen nur gegen die lokale Testumgebung (siehe tests/roboter/playwright.config.ts).");
}

export type Rolle = "administrator" | "mitarbeiter";
export type Konto = { id: string; email: string; passwort: string };

/** SQL direkt in der Docker-Testdatenbank (am RLS und an Triggern vorbei). */
export function sql(abfrage: string): string {
  return execFileSync(
    "docker",
    ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", abfrage],
    { encoding: "utf8" },
  ).trim();
}

export async function dienst(pfad: string, methode = "GET", body?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(`${API}${pfad}`, {
    method: methode,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Datei aus dem Speicher der Testumgebung (Service-Schlüssel). */
export async function speicherLesen(bucket: string, pfad: string): Promise<Uint8Array> {
  const r = await fetch(`${API}/storage/v1/object/${bucket}/${pfad.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  if (!r.ok) throw new Error(`Speicher ${bucket}/${pfad}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function speicherLoeschen(bucket: string, pfad: string) {
  await fetch(`${API}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [pfad] }),
  });
}

/** Ein aktives Konto aus den anonymisierten Echtdaten – so prüft man genau das, was diese Rolle im Betrieb sieht. */
export function kontoAusDaten(rolle: Rolle): Konto {
  const zeile = sql(`
    select u.id || '|' || u.email from auth.users u
    join public.user_roles r on r.user_id = u.id
    join public.profiles p on p.id = u.id
    where r.role = '${rolle}' and u.email like 'nutzer%@example.invalid' and coalesce(p.is_active, false)
    order by u.email limit 1`);
  if (!zeile) throw new Error(`Kein Konto mit Rolle ${rolle} – wurde »testumgebung.mjs daten« ausgeführt?`);
  const [id, email] = zeile.split("|");
  return { id, email, passwort: DATEN_PASSWORT };
}

/** Eigenes Konto (für Fälle, die in den Echtdaten fehlen). Wieder löschen mit kontoLoeschen. */
export async function kontoAnlegen(name: string, rolle: Rolle, aktiv = true): Promise<Konto> {
  const email = `grundtest-${name}-${Date.now()}@test.invalid`;
  const passwort = "Grundtest-2026!";
  const konto = await dienst("/auth/v1/admin/users", "POST", {
    email, password: passwort, email_confirm: true, user_metadata: { vorname: "Grundtest", nachname: name },
  });
  sql(`set session_replication_role = replica;
       insert into public.profiles (id, vorname, nachname, is_active) values ('${konto.id}', 'Grundtest', '${name}', ${aktiv})
         on conflict (id) do update set is_active = excluded.is_active;
       delete from public.user_roles where user_id = '${konto.id}';
       insert into public.user_roles (user_id, role) values ('${konto.id}', '${rolle}');`);
  return { id: konto.id, email, passwort };
}

export async function kontoLoeschen(konto?: Konto) {
  if (!konto) return;
  sql(`set session_replication_role = replica;
       delete from public.user_roles where user_id = '${konto.id}';
       delete from public.profiles where id = '${konto.id}';`);
  await dienst(`/auth/v1/admin/users/${konto.id}`, "DELETE");
}

/** Zugriffstoken wie im Browser – für Rechteprüfungen direkt an der Datenbank (RLS). */
export async function tokenHolen(konto: Konto): Promise<string> {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: konto.email, password: konto.passwort }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Anmeldung von ${konto.email} fehlgeschlagen: ${r.status}`);
  return j.access_token;
}

/** Tabelle so lesen, wie es die angemeldete Rolle (oder ohne token: jemand ohne Anmeldung) dürfte. */
export async function lesenAls(token: string | null, pfad: string) {
  const r = await fetch(`${API}/rest/v1/${pfad}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}` },
  });
  const text = await r.text();
  let zeilen: unknown[] = [];
  try { const j = JSON.parse(text); if (Array.isArray(j)) zeilen = j; } catch { /* Fehlermeldung, keine Zeilen */ }
  return { status: r.status, zeilen };
}

const benutzerAusToken = (kopf: string | undefined) => {
  try { return JSON.parse(Buffer.from((kopf ?? "").replace(/^Bearer\s+/i, "").split(".")[1], "base64url").toString()).sub as string; }
  catch { return ""; }
};

// Die Felder, die supabase/functions/create-team-time-entries übernimmt (rowFrom).
const ZEIT_FELDER = [
  "id", "user_id", "datum", "project_id", "disturbance_id", "taetigkeit", "stunden", "start_time", "end_time", "pause_minutes",
  "pause_start", "pause_end", "location_type", "notizen", "week_type",
];

/**
 * create-team-time-entries läuft hier nicht als Funktion; ohne sie ginge keine einzige Buchung durch. Der Test macht
 * ihren Kern nach – inklusive der Prüfung, dass man nur für sich selbst bucht – und meldet die Ids zurück.
 */
async function zeitBuchungNachstellen(kopf: string | undefined, body: { mainEntry: Record<string, unknown>; teamEntries?: Record<string, unknown>[]; skipMainEntry?: boolean }) {
  if (!body.skipMainEntry && body.mainEntry.user_id !== benutzerAusToken(kopf)) {
    return { status: 403, antwort: { error: "Nur für sich selbst buchen" } };
  }
  const alle = [...(body.skipMainEntry ? [] : [body.mainEntry]), ...(body.teamEntries ?? [])];
  const zeilen = alle.map((e) => Object.fromEntries(ZEIT_FELDER.map((f) => [f, e[f] ?? null])));
  const neu: { id: string }[] = zeilen.length
    ? await dienst("/rest/v1/time_entries", "POST", zeilen, { Prefer: "return=representation" })
    : [];
  return { status: 200, antwort: { success: true, mainEntryId: neu[0]?.id, teamEntryIds: neu.slice(1).map((z) => z.id), totalCreated: neu.length } };
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

/**
 * Sperren für jeden Test im Browser (CLAUDE.md: keine Nachrichten an echte Personen, nichts in OneDrive/Outlook):
 * - beleg-pdf und send-disturbance-report im Modus nurPdf gehen an die echte Funktion in Docker (funktionen.ts).
 * - Jeder andere Funktionsaufruf (Mailversand, Outlook, OneDrive, KI) läuft nicht, wird gezählt und mit {} beantwortet.
 * - Alles außerhalb der Testumgebung wird abgewürgt und gemerkt; ein Aufruf der echten Supabase lässt den Test scheitern.
 */
export async function sperrenSetzen(page: Page) {
  const zustand = { funktionen: [] as string[], fremd: [] as string[], seitenFehler: [] as string[], fehlerAntworten: [] as string[] };
  page.on("response", (r) => {
    if (r.url().startsWith(API) && r.status() >= 400) {
      zustand.fehlerAntworten.push(`${r.status()} ${r.request().method()} ${r.url().slice(API.length, API.length + 120)}`);
    }
  });
  await page.route("**/*", async (route) => {
    const anfrage = route.request();
    const url = anfrage.url();
    const fn = url.match(/\/functions\/v1\/([^/?]+)/)?.[1];
    if (fn && anfrage.method() === "OPTIONS") return route.fulfill({ status: 200, headers: CORS, body: "ok" });
    if (fn === "create-team-time-entries") {
      const { status, antwort } = await zeitBuchungNachstellen(await anfrage.headerValue("authorization") ?? undefined, anfrage.postDataJSON());
      return route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(antwort) });
    }
    if (fn === "beleg-pdf" || (fn === "send-disturbance-report" && anfrage.postDataJSON()?.nurPdf === true)) {
      const antwort = await route.fetch({ url: `http://127.0.0.1:${funktionsPort(fn)}/`, timeout: 90_000 });
      return route.fulfill({ response: antwort, headers: { ...antwort.headers(), ...CORS } });
    }
    if (fn) {
      let aktion = "";
      try { aktion = anfrage.postDataJSON()?.aktion ?? ""; } catch { /* kein JSON */ }
      zustand.funktionen.push(aktion ? `${fn}:${aktion}` : fn);
      return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: "{}" });
    }
    if (url.startsWith(APP) || url.startsWith(API) || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    zustand.fremd.push(url);
    return route.abort();
  });
  page.on("pageerror", (e) => zustand.seitenFehler.push(e.message));
  return zustand;
}

export function keineEchteDatenbank(zustand: { fremd: string[] }) {
  expect(zustand.fremd.filter((u) => /supabase\.(co|in)|handwerkapp\.at|vercel\.app|graph\.microsoft/.test(u))).toEqual([]);
}

/** Abfragen, die die Datenbank ablehnt (falsche Spalte, fehlendes Recht …). */
export function abgelehnteAbfragen(zustand: { fehlerAntworten: string[] }) {
  return zustand.fehlerAntworten.filter((z) => /\/rest\/v1\//.test(z));
}

export async function anmelden(page: Page, konto: Konto) {
  await page.goto(`${APP}/auth`);
  await page.locator("#email").fill(konto.email);
  await page.locator("#password").fill(konto.passwort);
  await page.locator("#password").press("Enter");
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 30_000 });
}

/** PDF-Text mit pdfjs (dieselbe Bibliothek wie in der App), damit nicht nur »Datei da«, sondern der Inhalt geprüft wird. */
export async function pdfText(daten: Uint8Array): Promise<string> {
  expect(new TextDecoder().decode(daten.slice(0, 5))).toBe("%PDF-");
  const pdfjs = createRequire(import.meta.url)("pdfjs-dist/legacy/build/pdf.js");
  const dok = await pdfjs.getDocument({ data: daten, useSystemFonts: true, isEvalSupported: false }).promise;
  let text = "";
  for (let n = 1; n <= dok.numPages; n++) {
    const inhalt = await (await dok.getPage(n)).getTextContent();
    text += inhalt.items.map((i: { str?: string }) => i.str ?? "").join(" ") + "\n";
  }
  return text.replace(/\s+/g, " ");
}

/** Ein Tag, an dem das Konto noch keine Stunden hat (in der Vergangenheit, Mittwoch). */
export function freierTag(userId: string, abTagen = 400): string {
  for (let i = abTagen; i < abTagen + 400; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    if (d.getDay() !== 3) continue;
    const iso = d.toISOString().slice(0, 10);
    if (sql(`select count(*) from public.time_entries where user_id = '${userId}' and datum = '${iso}'`) === "0") return iso;
  }
  throw new Error("Kein freier Tag gefunden");
}
