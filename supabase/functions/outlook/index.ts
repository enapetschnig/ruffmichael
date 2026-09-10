// Outlook-Anbindung (Microsoft 365) — Postfach, Versand und Kalender.
//
// Dieselbe App-Registrierung wie der OneDrive-Sync, zusätzlich die
// Anwendungsberechtigungen Mail.ReadWrite, Mail.Send und Calendars.ReadWrite
// (mit Administratorzustimmung). Angesprochen wird ausschließlich das Postfach
// aus MS_MAIL_TARGET (Rückfallwert: MS_DRIVE_TARGET) — office@ruffinstallateur.at.
//
// Aktionen (POST { aktion: … } oder ?action=…):
//   test            Verbindung + erteilte Berechtigungen zeigen
//   sync            neue Mails holen, einordnen, Eingangsrechnungen anlegen
//   senden          neue Mail verschicken (mit Anhängen aus dem Speicher)
//   kalender        Termine eines Zeitraums
//
// Zugriff: Administrator-Anmeldung oder der Service-Schlüssel (pg_cron).
//
// ⛔ In Outlook wird NICHTS verändert und NICHTS gelöscht. Am Postfach und am
// Kalender arbeitet die Funktion ausschließlich lesend (GET) — sie kennt für
// vorhandene Mails und Termine keinen PATCH-, PUT- oder DELETE-Aufruf. Der
// einzige schreibende Weg ist das Verschicken einer neuen Mail (sendMail), das
// der Betrieb selbst auslöst. Gelesen/erledigt-Markierungen der App bleiben in
// der App.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH = "https://graph.microsoft.com/v1.0";
const ZEITZONE = "Europe/Vienna";
const BUCKET = "mail-anhaenge";
const MAX_ANHANG = 25 * 1024 * 1024;          // größere Anhänge bleiben in Outlook
const KOERPER_MAX = 50_000;                    // Zeichen, die wir speichern
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Ordner, die nicht in die App gehören — Papierkorb, Werbung, Entwürfe und
// die Systemordner, die Outlook selbst anlegt (Konflikte, Serverfehler …).
const ORDNER_AUS = /^(gelöschte elemente|deleted items|junk-e-mail|junk email|spam|entwürfe|drafts|konflikte|conflicts|synchronisierungsprobleme|sync issues|serverfehler|server failures|lokale fehler|local failures|rss)/i;

type GraphMail = {
  id: string; internetMessageId?: string; conversationId?: string; subject?: string;
  bodyPreview?: string; body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  sender?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  ccRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  receivedDateTime?: string; sentDateTime?: string; isRead?: boolean;
  importance?: string; hasAttachments?: boolean; parentFolderId?: string; webLink?: string;
};

// ── Microsoft-Anmeldung ────────────────────────────────────────────────────
async function token(): Promise<string> {
  const tenant = Deno.env.get("MS_TENANT_ID"), clientId = Deno.env.get("MS_CLIENT_ID"), secret = Deno.env.get("MS_CLIENT_SECRET");
  if (!tenant || !clientId || !secret) throw new Error("Die Microsoft-Zugangsdaten fehlen (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET).");
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Microsoft-Anmeldung fehlgeschlagen: ${data.error_description || JSON.stringify(data)}`);
  return data.access_token;
}

/** Die im Zugangstoken enthaltenen Berechtigungen — für die Testausgabe. */
function rollenAusToken(tok: string): string[] {
  try {
    const teil = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const daten = JSON.parse(atob(teil.padEnd(teil.length + (4 - teil.length % 4) % 4, "=")));
    return Array.isArray(daten.roles) ? daten.roles : [];
  } catch { return []; }
}

async function graph<T>(tok: string, pfad: string, init?: RequestInit & { prefer?: string }): Promise<T> {
  const kopf: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (init?.body) kopf["Content-Type"] = "application/json";
  if (init?.prefer) kopf["Prefer"] = init.prefer;
  const res = await fetch(pfad.startsWith("http") ? pfad : `${GRAPH}${pfad}`, { ...init, headers: { ...kopf, ...(init?.headers as Record<string, string> ?? {}) } });
  if (res.status === 204) return {} as T;
  const text = await res.text();
  if (!res.ok) {
    let hinweis = `Graph ${res.status}: ${text.slice(0, 400)}`;
    if (res.status === 403) hinweis += "\nFehlt die Administratorzustimmung für Mail.ReadWrite / Mail.Send / Calendars.ReadWrite?";
    throw new Error(hinweis);
  }
  return text ? JSON.parse(text) as T : {} as T;
}

const postfach = () => {
  const ziel = Deno.env.get("MS_MAIL_TARGET") || Deno.env.get("MS_DRIVE_TARGET") || "";
  if (!ziel.includes("@")) throw new Error("Kein Postfach eingestellt — MS_MAIL_TARGET muss eine E-Mail-Adresse sein.");
  return encodeURIComponent(ziel);
};

// ── Einordnung: erst Regeln, dann (bei Verdacht) die KI ────────────────────
const RECHNUNG_WORT = /\b(rechnung|faktura|invoice|rechnungsnr|re-nr|zahlungsaufforderung|honorarnote)\b/i;
const MAHNUNG_WORT = /\b(mahnung|zahlungserinnerung|letzte aufforderung|verzug|inkasso)\b/i;
const WERBUNG_WORT = /(newsletter|abmelden|unsubscribe|aktion|rabattcode|webinar|gewinnspiel)/i;
const LIEFERSCHEIN_WORT = /\b(lieferschein|lieferavis|versandbest|paket|sendungsverfolgung|tracking)\b/i;
const ANGEBOT_WORT = /\b(angebot|offert|kostenvoranschlag|preisliste)\b/i;
const BESTELL_WORT = /\b(bestellung|auftragsbest|order)\b/i;
const BEHOERDE_WORT = /(finanzamt|gebietskrankenkasse|ögk|wko|wirtschaftskammer|magistrat|bezirkshauptmannschaft|gkk|bmf\.gv\.at)/i;

/** Grobe Vorsortierung ohne KI — spart Kosten und fängt den Normalfall ab. */
function regelKategorie(m: { betreff: string; text: string; von: string; anhangNamen: string[] }): { kategorie: string; sicherheit: number; grund: string } | null {
  const alles = `${m.betreff} ${m.anhangNamen.join(" ")}`;
  const pdfDabei = m.anhangNamen.some((n) => /\.pdf$/i.test(n));
  if (MAHNUNG_WORT.test(alles)) return { kategorie: "mahnung", sicherheit: 0.9, grund: "Wort „Mahnung/Zahlungserinnerung“ im Betreff" };
  if (RECHNUNG_WORT.test(alles) && pdfDabei) return { kategorie: "eingangsrechnung", sicherheit: 0.9, grund: "„Rechnung“ im Betreff und PDF im Anhang" };
  if (RECHNUNG_WORT.test(alles)) return { kategorie: "eingangsrechnung", sicherheit: 0.6, grund: "„Rechnung“ im Betreff, aber kein PDF" };
  if (BEHOERDE_WORT.test(`${m.von} ${alles}`)) return { kategorie: "behoerde", sicherheit: 0.8, grund: "Absender ist eine Behörde/Kammer" };
  if (LIEFERSCHEIN_WORT.test(alles)) return { kategorie: "lieferschein", sicherheit: 0.75, grund: "Liefer-/Versandmeldung" };
  if (BESTELL_WORT.test(alles)) return { kategorie: "bestellung", sicherheit: 0.7, grund: "Bestell-/Auftragsbestätigung" };
  if (ANGEBOT_WORT.test(alles)) return { kategorie: "angebot", sicherheit: 0.7, grund: "Angebot/Kostenvoranschlag" };
  if (WERBUNG_WORT.test(m.text) && !pdfDabei) return { kategorie: "werbung", sicherheit: 0.7, grund: "Newsletter-Merkmale im Text" };
  return null;
}

const KI_SCHEMA = {
  name: "einordnung",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      kategorie: { type: "string", enum: ["eingangsrechnung", "mahnung", "angebot", "bestellung", "lieferschein", "kundenanfrage", "behoerde", "werbung", "sonstiges"] },
      sicherheit: { type: "number" },
      grund: { type: "string" },
      lieferant: { type: ["string", "null"] },
      nummer: { type: ["string", "null"] },
      datum: { type: ["string", "null"] },
      faellig_am: { type: ["string", "null"] },
      netto: { type: ["number", "null"] },
      ust: { type: ["number", "null"] },
      brutto: { type: ["number", "null"] },
      iban: { type: ["string", "null"] },
      verwendungszweck: { type: ["string", "null"] },
      skonto_prozent: { type: ["number", "null"] },
      skonto_bis: { type: ["string", "null"] },
    },
    required: ["kategorie", "sicherheit", "grund", "lieferant", "nummer", "datum", "faellig_am", "netto", "ust", "brutto", "iban", "verwendungszweck", "skonto_prozent", "skonto_bis"],
  },
};

async function kiEinordnen(stoff: string): Promise<Record<string, unknown> | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        response_format: { type: "json_schema", json_schema: KI_SCHEMA },
        messages: [
          {
            role: "system",
            content: [
              "Du sortierst die Post eines österreichischen Installateurbetriebs (Ruff Michael GmbH, Heizung/Sanitär).",
              "Ordne die Nachricht genau einer Kategorie zu. „eingangsrechnung“ nur, wenn der Betrieb selbst zahlen muss",
              "(Lieferant, Großhändler, Dienstleister, Versicherung, Leasing). Eine Rechnung, die der Betrieb selbst",
              "an einen Kunden geschickt hat, ist KEINE Eingangsrechnung — das ist „sonstiges“.",
              "Schreibt ein KUNDE (Privatperson, Bauherr) — etwa weil er auf eine Rechnung wartet, eine Zahlung",
              "reklamiert, sich beschwert oder einen Mangel meldet —, dann ist das IMMER „kundenanfrage“,",
              "auch wenn „Mahnung“ oder „Rechnung“ im Betreff steht und Beträge genannt werden.",
              "„mahnung“ ist nur die Zahlungserinnerung eines Lieferanten AN den Betrieb.",
              "Bei einer Eingangsrechnung oder Mahnung: Beträge, Nummern und Daten wörtlich aus dem Text übernehmen,",
              "nichts schätzen. Fehlt ein Wert, gib null. Daten als JJJJ-MM-TT. Beträge als Zahl mit Punkt als",
              "Dezimaltrennzeichen (österreichisch „1.234,56“ bedeutet 1234.56). sicherheit ist 0 bis 1.",
            ].join(" "),
          },
          { role: "user", content: stoff.slice(0, 14000) },
        ],
      }),
    });
    if (!res.ok) { console.error("KI-Einordnung fehlgeschlagen:", (await res.text()).slice(0, 300)); return null; }
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content ?? "null");
  } catch (e) {
    console.error("KI-Einordnung abgebrochen:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Text aus einem PDF — damit die KI Beträge und Nummern findet. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("https://esm.sh/unpdf@0.12.1");
    const doc = await getDocumentProxy(bytes);
    const { text } = await extractText(doc, { mergePages: true });
    return String(text ?? "").replace(/\s+\n/g, "\n").slice(0, 12000);
  } catch (e) {
    console.error("PDF nicht lesbar:", e instanceof Error ? e.message : e);
    return "";
  }
}

const zahl = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const datumWert = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const UMLAUT: Record<string, string> = { "ä": "ae", "Ä": "Ae", "ö": "oe", "Ö": "Oe", "ü": "ue", "Ü": "Ue", "ß": "ss" };
/**
 * Dateiname für den Speicher. Supabase-Schlüssel vertragen nur ASCII —
 * „Würth-AB Kolo.PDF“ scheitert sonst mit „Invalid key“. Angezeigt wird
 * weiterhin der Originalname aus der Mail, nur der Pfad wird entschärft.
 */
/** HTML-Mail zu lesbarem Text — für Suche, Vorschau und die Einordnung. */
function htmlZuText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

const sauber = (s: string) => (
  s.replace(/[äÄöÖüÜß]/g, (c) => UMLAUT[c] ?? c)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_").replace(/^[_.]+|_+$/g, "")
    .slice(0, 120) || "anhang"
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const dienst = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supaUrl, dienst);

  try {
    // ── Wer darf? Administrator oder der Zeitplan (Service-Schlüssel) ──────
    const authKopf = req.headers.get("Authorization") ?? "";
    const istCron = authKopf === `Bearer ${dienst}`;
    let benutzerId: string | null = null;
    if (!istCron) {
      const { data: { user } } = await createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authKopf } } }).auth.getUser();
      if (!user) return json({ error: "Nicht angemeldet." }, 401);
      const { data: rolle } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "administrator").maybeSingle();
      if (!rolle) return json({ error: "Nur Administratoren." }, 403);
      benutzerId = user.id;
    }

    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") { try { body = await req.json(); } catch { /* leerer Rumpf ist erlaubt */ } }
    const aktion = String(body.aktion ?? url.searchParams.get("action") ?? "sync");
    const tok = await token();
    const mb = postfach();

    // ── Verbindung prüfen ─────────────────────────────────────────────────
    if (aktion === "test") {
      const rollen = rollenAusToken(tok);
      const ergebnis: Record<string, unknown> = { postfach: decodeURIComponent(mb), berechtigungen: rollen };
      // Lesen genügt uns; .All-Varianten zählen ebenso
      const erfuellt = (wunsch: string) => rollen.some((r) => r.startsWith(wunsch.split(".")[0] + ".") && (r.includes("Read") || r.includes("Send")) && (wunsch !== "Mail.Send" || r === "Mail.Send"));
      ergebnis.fehlend = ["Mail.Read", "Mail.Send", "Calendars.Read"].filter((w) => !erfuellt(w));
      try {
        const posteingang = await graph<{ totalItemCount: number; unreadItemCount: number }>(tok, `/users/${mb}/mailFolders/inbox?$select=totalItemCount,unreadItemCount`);
        ergebnis.posteingang = posteingang;
      } catch (e) { ergebnis.mail_fehler = e instanceof Error ? e.message : String(e); }
      try {
        const kal = await graph<{ value: unknown[] }>(tok, `/users/${mb}/calendars?$select=name&$top=5`);
        ergebnis.kalender = (kal.value as { name: string }[]).map((k) => k.name);
      } catch (e) { ergebnis.kalender_fehler = e instanceof Error ? e.message : String(e); }
      return json({ ok: !ergebnis.mail_fehler && !ergebnis.kalender_fehler, ...ergebnis });
    }

    // ── Mails holen ───────────────────────────────────────────────────────
    if (aktion === "sync") {
      const start = Date.now();
      const budget = Number(body.zeit ?? url.searchParams.get("zeit") ?? 90) * 1000;
      const { data: zustand } = await admin.from("mail_sync_state").select("*").eq("id", "postfach").maybeSingle();
      // Erster Lauf: die letzten n Tage, danach ab dem letzten Lauf (mit Überlappung,
      // damit nachträglich gelesene/verschobene Mails mitkommen).
      const tage = Number(body.tage ?? url.searchParams.get("tage") ?? 0);
      const ab = tage > 0
        ? new Date(Date.now() - tage * 86400000)
        : zustand?.letzter_lauf
          ? new Date(new Date(zustand.letzter_lauf).getTime() - 2 * 86400000)
          : new Date(Date.now() - 60 * 86400000);

      // Ordnernamen einmal auflösen (Posteingang, Gesendete Elemente, eigene Ordner)
      const ordner = new Map<string, string>();
      const ordnerLaden = async (pfad: string) => {
        let next: string | null = pfad;
        while (next) {
          const seite: { value: { id: string; displayName: string; childFolderCount: number }[]; "@odata.nextLink"?: string } = await graph(tok, next);
          for (const o of seite.value) {
            ordner.set(o.id, o.displayName);
            if (o.childFolderCount > 0) await ordnerLaden(`/users/${mb}/mailFolders/${o.id}/childFolders?$select=id,displayName,childFolderCount&$top=100`);
          }
          next = seite["@odata.nextLink"] ?? null;
        }
      };
      await ordnerLaden(`/users/${mb}/mailFolders?$select=id,displayName,childFolderCount&$top=100`);

      const felder = "id,internetMessageId,conversationId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,importance,hasAttachments,parentFolderId,webLink";
      let next: string | null = `${GRAPH}/users/${mb}/messages?$select=${felder}&$filter=receivedDateTime ge ${ab.toISOString().slice(0, 19)}Z&$orderby=receivedDateTime desc&$top=25`;

      // Kunden für die Zuordnung nach Absenderadresse
      const { data: kunden } = await admin.from("customers").select("id, email").not("email", "is", null);
      const kundeNach = new Map((kunden ?? []).filter((k) => k.email).map((k) => [String(k.email).toLowerCase().trim(), k.id]));

      // Bekannte Mails einmal laden — sonst kostet jede schon vorhandene Mail
      // eine eigene Abfrage und der Nachlauf über alte Monate kommt nie durch.
      const bekannt = new Map<string, { id: string; gelesen: boolean; ordner: string }>();
      for (let von = 0; ; von += 1000) {
        const { data } = await admin.from("mails").select("id, graph_id, gelesen, ordner").range(von, von + 999);
        for (const m of data ?? []) bekannt.set(m.graph_id, { id: m.id, gelesen: m.gelesen, ordner: m.ordner });
        if (!data || data.length < 1000) break;
      }

      let neu = 0, aktualisiert = 0, rechnungen = 0, anhaenge = 0, gesehen = 0;
      let offen = false;
      const fehler: string[] = [];

      while (next) {
        if (Date.now() - start > budget) { offen = true; break; }
        // Ohne Prefer-Header liefert Graph den Rumpf als HTML — so sieht die
        // Mail in der App aus wie in Outlook. Den Text leiten wir daraus ab.
        const seite: { value: GraphMail[]; "@odata.nextLink"?: string } = await graph(tok, next);
        next = seite["@odata.nextLink"] ?? null;

        for (const m of seite.value) {
          if (Date.now() - start > budget) { offen = true; break; }
          gesehen++;
          const ordnerName = ordner.get(m.parentFolderId ?? "") ?? "Posteingang";
          if (ORDNER_AUS.test(ordnerName)) continue;
          const gesendeterOrdner = /^(gesendete elemente|sent items)$/i.test(ordnerName);
          const von = m.from?.emailAddress ?? m.sender?.emailAddress ?? {};
          const vonAdresse = (von.address ?? "").toLowerCase();
          const betreff = m.subject ?? "(kein Betreff)";
          const html = m.body?.contentType === "html" ? (m.body?.content ?? "") : "";
          const text = html ? htmlZuText(html) : (m.body?.content ?? m.bodyPreview ?? "");

          const schon = bekannt.get(m.id);
          if (schon) {
            // Vorhandene Mail: nur nachziehen, was sich in Outlook geändert hat.
            // Einordnung und Zuordnung des Benutzers bleiben unangetastet.
            if (schon.gelesen !== !!m.isRead || schon.ordner !== ordnerName) {
              await admin.from("mails").update({ gelesen: !!m.isRead, ordner: ordnerName, web_link: m.webLink ?? null }).eq("id", schon.id);
            }
            aktualisiert++;
            continue;
          }

          const satz = {
            graph_id: m.id,
            internet_message_id: m.internetMessageId ?? null,
            konversation_id: m.conversationId ?? null,
            ordner: ordnerName,
            richtung: gesendeterOrdner ? "ausgang" : "eingang",
            von_name: von.name ?? null,
            von_adresse: vonAdresse || null,
            an_adressen: (m.toRecipients ?? []).map((r) => ({ name: r.emailAddress?.name, adresse: r.emailAddress?.address })),
            cc_adressen: (m.ccRecipients ?? []).map((r) => ({ name: r.emailAddress?.name, adresse: r.emailAddress?.address })),
            betreff,
            vorschau: (m.bodyPreview ?? "").slice(0, 500),
            koerper_text: text.slice(0, KOERPER_MAX),
            koerper_html: html ? html.slice(0, 400_000) : null,
            empfangen_am: m.receivedDateTime ?? m.sentDateTime ?? new Date().toISOString(),
            gelesen: !!m.isRead,
            wichtig: m.importance === "high",
            hat_anhang: !!m.hasAttachments,
            web_link: m.webLink ?? null,
            kunde_id: kundeNach.get(vonAdresse) ?? null,
            geholt_am: new Date().toISOString(),
          };

          const { data: angelegt, error: fehlerMail } = await admin.from("mails").insert(satz).select("id").single();
          if (fehlerMail || !angelegt) { fehler.push(`${betreff}: ${fehlerMail?.message}`); continue; }
          neu++;
          const mailId = angelegt.id as string;

          // ── Anhänge ──────────────────────────────────────────────────────
          const anhangNamen: string[] = [];
          let ersterBeleg: { id: string; pfad: string; bytes: Uint8Array } | null = null;
          if (m.hasAttachments) {
            try {
              const liste = await graph<{ value: { id: string; name: string; contentType: string; size: number; isInline: boolean; "@odata.type": string }[] }>(
                tok, `/users/${mb}/messages/${m.id}/attachments?$select=id,name,contentType,size,isInline`);
              for (const a of liste.value) {
                if (a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
                // Bilder aus Signaturen (image001.png …) sind keine Anlagen
                if (a.isInline) continue;
                const belegArtig = /\.(pdf|jpg|jpeg|png|heic|xml|zip|docx?|xlsx?)$/i.test(a.name);
                anhangNamen.push(a.name);
                let pfad: string | null = null;
                let bytes: Uint8Array | null = null;
                if (belegArtig && a.size <= MAX_ANHANG) {
                  try {
                    const roh = await fetch(`${GRAPH}/users/${mb}/messages/${m.id}/attachments/${a.id}/$value`, { headers: { Authorization: `Bearer ${tok}` } });
                    if (roh.ok) {
                      bytes = new Uint8Array(await roh.arrayBuffer());
                      pfad = `${(satz.empfangen_am as string).slice(0, 7)}/${mailId}/${sauber(a.name)}`;
                      const { error: e } = await admin.storage.from(BUCKET).upload(pfad, bytes, { contentType: a.contentType || "application/octet-stream", upsert: true });
                      if (e) { fehler.push(`Anhang ${a.name}: ${e.message}`); pfad = null; }
                      else anhaenge++;
                    }
                  } catch (e) { fehler.push(`Anhang ${a.name}: ${e instanceof Error ? e.message : e}`); }
                }
                const { data: anh } = await admin.from("mail_anhaenge").insert({
                  mail_id: mailId, graph_id: a.id, name: a.name, mime: a.contentType, groesse: a.size, pfad, ist_beleg: belegArtig,
                }).select("id").single();
                if (anh && pfad && bytes && /\.pdf$/i.test(a.name) && !ersterBeleg) ersterBeleg = { id: anh.id as string, pfad, bytes };
              }
            } catch (e) { fehler.push(`Anhänge zu „${betreff}“: ${e instanceof Error ? e.message : e}`); }
          }

          // ── Einordnen ────────────────────────────────────────────────────
          if (gesendeterOrdner) {
            await admin.from("mails").update({ kategorie: "sonstiges", kategorie_quelle: "regel", kategorie_grund: "selbst gesendet" }).eq("id", mailId);
            continue;
          }
          const regel = regelKategorie({ betreff, text, von: vonAdresse, anhangNamen });
          const verdacht = !regel || ["eingangsrechnung", "mahnung"].includes(regel.kategorie) || regel.sicherheit < 0.8;
          let ki: Record<string, unknown> | null = null;
          if (verdacht) {
            const belegText = ersterBeleg ? await pdfText(ersterBeleg.bytes) : "";
            ki = await kiEinordnen([
              `Absender: ${von.name ?? ""} <${vonAdresse}>`,
              `Betreff: ${betreff}`,
              anhangNamen.length ? `Anhänge: ${anhangNamen.join(", ")}` : "Anhänge: keine",
              `Nachricht:\n${text.slice(0, 3000)}`,
              belegText ? `\nInhalt des PDF-Anhangs:\n${belegText}` : "",
            ].join("\n"));
          }
          const kategorie = String(ki?.kategorie ?? regel?.kategorie ?? "sonstiges");
          const sicherheit = Number(ki?.sicherheit ?? regel?.sicherheit ?? 0.5);
          await admin.from("mails").update({
            kategorie,
            kategorie_quelle: ki ? "ki" : regel ? "regel" : null,
            kategorie_sicherheit: Math.max(0, Math.min(1, sicherheit)),
            kategorie_grund: String(ki?.grund ?? regel?.grund ?? ""),
          }).eq("id", mailId);

          // ── Eingangsrechnung anlegen ─────────────────────────────────────
          // Zurückhaltend: Nur was wirklich eine eigene Verbindlichkeit ist.
          // - Mahnungen legen nichts an: sie gehören meist zu einer schon
          //   erfassten Rechnung (sonst Doppel) und „Mahnung“ im Betreff
          //   schreibt auch ein Kunde, der auf SEINE Rechnung wartet.
          // - Kommt die Mail von einem eingetragenen Kunden, ist es keine
          //   Lieferantenrechnung. Über „Ist eine Rechnung“ geht es von Hand.
          const eigeneSchuld = kategorie === "eingangsrechnung" && !satz.kunde_id;
          if (eigeneSchuld) {
            const lieferant = String(ki?.lieferant ?? von.name ?? vonAdresse ?? "Unbekannt").slice(0, 200);
            // Dieselbe Rechnung kommt oft zweimal (Original + Weiterleitung).
            // Gleiche Rechnungsnummer beim selben Lieferanten heißt: schon da.
            const nummer = ki?.nummer ? String(ki.nummer).slice(0, 60) : null;
            if (nummer) {
              const { data: schonDa } = await admin.from("eingangsrechnungen")
                .select("id, pdf_pfad").eq("nummer", nummer).ilike("lieferant", lieferant.slice(0, 40) + "%").limit(1);
              if (schonDa && schonDa.length) {
                // Fehlt dort noch das PDF, reichen wir es nach
                if (!schonDa[0].pdf_pfad && ersterBeleg) {
                  await admin.from("eingangsrechnungen").update({ pdf_pfad: ersterBeleg.pfad, anhang_id: ersterBeleg.id }).eq("id", schonDa[0].id);
                }
                continue;
              }
            }
            const { error: e } = await admin.from("eingangsrechnungen").insert({
              mail_id: mailId,
              anhang_id: ersterBeleg?.id ?? null,
              lieferant,
              nummer,
              datum: datumWert(ki?.datum) ?? (satz.empfangen_am as string).slice(0, 10),
              faellig_am: datumWert(ki?.faellig_am),
              netto: zahl(ki?.netto), ust: zahl(ki?.ust), brutto: zahl(ki?.brutto),
              iban: ki?.iban ? String(ki.iban).replace(/\s+/g, "").slice(0, 34) : null,
              verwendungszweck: ki?.verwendungszweck ? String(ki.verwendungszweck).slice(0, 200) : null,
              skonto_prozent: zahl(ki?.skonto_prozent),
              skonto_bis: datumWert(ki?.skonto_bis),
              pdf_pfad: ersterBeleg?.pfad ?? null,
              quelle: "mail",
              erkannt_von: ki ? "ki" : "regel",
              sicherheit: Math.max(0, Math.min(1, sicherheit)),
            });
            if (!e) rechnungen++;
            else if (!e.message.includes("duplicate")) fehler.push(`Eingangsrechnung „${betreff}“: ${e.message}`);
          }
        }
      }

      // ── Aufräumen in beide Richtungen ─────────────────────────────────
      // Was Michael in Outlook in den Papierkorb oder in Junk legt, soll auch
      // in der App verschwinden — sonst sammelt sie an, was er längst weg hat.
      // Gelöscht wird nur bei UNS; in Outlook rührt die Funktion nichts an.
      let entfernt = 0;
      if (!offen && bekannt.size > 0) {
        try {
          const wegIds = new Set<string>();
          const seitAb = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 19) + "Z";
          for (const korb of ["deleteditems", "junkemail"]) {
            let next: string | null = `${GRAPH}/users/${mb}/mailFolders/${korb}/messages?$select=id&$top=500&$filter=receivedDateTime ge ${seitAb}`;
            let seiten = 0;
            while (next && seiten++ < 8 && Date.now() - start < budget) {
              const seite: { value: { id: string }[]; "@odata.nextLink"?: string } = await graph(tok, next);
              for (const x of seite.value) wegIds.add(x.id);
              next = seite["@odata.nextLink"] ?? null;
            }
          }
          const treffer = [...bekannt.entries()].filter(([gid]) => wegIds.has(gid));
          if (treffer.length) {
            const ids = treffer.map(([, v]) => v.id);
            // Anhänge im Speicher mitnehmen — außer sie hängen an einer
            // Eingangsrechnung, die weiter bestehen bleibt.
            const { data: dateien } = await admin.from("mail_anhaenge").select("pfad").in("mail_id", ids).not("pfad", "is", null);
            const { data: belegt } = await admin.from("eingangsrechnungen").select("pdf_pfad").in("mail_id", ids).not("pdf_pfad", "is", null);
            const geschuetzt = new Set((belegt ?? []).map((b) => b.pdf_pfad as string));
            const loeschbar = (dateien ?? []).map((d) => d.pfad as string).filter((p) => !geschuetzt.has(p));
            if (loeschbar.length) await admin.storage.from(BUCKET).remove(loeschbar);
            const { error: e } = await admin.from("mails").delete().in("id", ids);
            if (e) fehler.push(`Aufräumen: ${e.message}`);
            else { entfernt = ids.length; for (const [gid] of treffer) bekannt.delete(gid); }
          }
        } catch (e) { fehler.push(`Papierkorb-Abgleich: ${e instanceof Error ? e.message : e}`); }
      }

      await admin.from("mail_sync_state").update({
        letzter_lauf: new Date().toISOString(),
        letzter_fehler: fehler.length ? fehler.slice(0, 5).join(" | ").slice(0, 1000) : null,
        anzahl_gesamt: (zustand?.anzahl_gesamt ?? 0) + neu,
        updated_at: new Date().toISOString(),
      }).eq("id", "postfach");

      return json({ ok: true, gesehen, neu, aktualisiert, entfernt, rechnungen, anhaenge, offen, fehler: fehler.slice(0, 5) });
    }

    // ── HTML nachholen ────────────────────────────────────────────────────
    // Für Mails, die vor der HTML-Anzeige geholt wurden (nur Text gespeichert).
    if (aktion === "html_nachholen") {
      const start = Date.now();
      const budget = Number(body.zeit ?? 90) * 1000;
      const { data: ohne } = await admin.from("mails").select("id, graph_id").is("koerper_html", null).order("empfangen_am", { ascending: false }).limit(400);
      let geholt = 0;
      const fehler: string[] = [];
      for (const m of ohne ?? []) {
        if (Date.now() - start > budget) break;
        try {
          const voll = await graph<GraphMail>(tok, `/users/${mb}/messages/${m.graph_id}?$select=body,bodyPreview`);
          const html = voll.body?.contentType === "html" ? (voll.body?.content ?? "") : "";
          const text = html ? htmlZuText(html) : (voll.body?.content ?? voll.bodyPreview ?? "");
          await admin.from("mails").update({
            koerper_html: html ? html.slice(0, 400_000) : "",
            koerper_text: text.slice(0, KOERPER_MAX),
          }).eq("id", m.id);
          geholt++;
        } catch (e) { fehler.push(`${m.graph_id.slice(0, 12)}: ${e instanceof Error ? e.message : e}`); }
      }
      const { count } = await admin.from("mails").select("id", { count: "exact", head: true }).is("koerper_html", null);
      return json({ ok: true, geholt, offen: count ?? 0, fehler: fehler.slice(0, 3) });
    }

    // ── Anhänge nachholen ─────────────────────────────────────────────────
    // Für Mails, deren Anlage beim Holen nicht gespeichert werden konnte
    // (z. B. früher an Umlauten im Dateinamen gescheitert). Die Mail selbst
    // bleibt dabei unangetastet, es wird nur die Datei nachgeladen.
    if (aktion === "anhaenge_nachholen") {
      const start = Date.now();
      const budget = Number(body.zeit ?? 90) * 1000;
      const { data: offeneAnhaenge } = await admin
        .from("mail_anhaenge")
        .select("id, mail_id, graph_id, name, mime, groesse, mails!inner(graph_id, empfangen_am)")
        .is("pfad", null).eq("ist_beleg", true).limit(300);
      let geholt = 0, uebersprungen = 0;
      const fehler: string[] = [];
      for (const a of (offeneAnhaenge ?? []) as unknown as { id: string; mail_id: string; graph_id: string; name: string; mime: string | null; groesse: number | null; mails: { graph_id: string; empfangen_am: string } }[]) {
        if (Date.now() - start > budget) break;
        if (!a.graph_id || (a.groesse ?? 0) > MAX_ANHANG) { uebersprungen++; continue; }
        try {
          const roh = await fetch(`${GRAPH}/users/${mb}/messages/${a.mails.graph_id}/attachments/${a.graph_id}/$value`, { headers: { Authorization: `Bearer ${tok}` } });
          if (!roh.ok) { fehler.push(`${a.name}: Graph ${roh.status}`); continue; }
          const bytes = new Uint8Array(await roh.arrayBuffer());
          const pfad = `${a.mails.empfangen_am.slice(0, 7)}/${a.mail_id}/${sauber(a.name)}`;
          const { error: e } = await admin.storage.from(BUCKET).upload(pfad, bytes, { contentType: a.mime || "application/octet-stream", upsert: true });
          if (e) { fehler.push(`${a.name}: ${e.message}`); continue; }
          await admin.from("mail_anhaenge").update({ pfad }).eq("id", a.id);
          // Eingangsrechnung ohne PDF nachträglich verknüpfen
          if (/\.pdf$/i.test(a.name)) {
            await admin.from("eingangsrechnungen").update({ pdf_pfad: pfad, anhang_id: a.id })
              .eq("mail_id", a.mail_id).is("pdf_pfad", null);
          }
          geholt++;
        } catch (e) { fehler.push(`${a.name}: ${e instanceof Error ? e.message : e}`); }
      }
      return json({ ok: true, offen_gewesen: offeneAnhaenge?.length ?? 0, geholt, uebersprungen, fehler: fehler.slice(0, 5) });
    }

    // ── Mail senden ───────────────────────────────────────────────────────
    if (aktion === "senden") {
      const an = (Array.isArray(body.an) ? body.an : String(body.an ?? "").split(/[;,]/)).map((s) => String(s).trim()).filter(Boolean);
      if (!an.length) return json({ error: "Es fehlt der Empfänger." }, 400);
      const betreff = String(body.betreff ?? "").trim() || "(kein Betreff)";
      const textRoh = String(body.text ?? "");
      const kopien = (Array.isArray(body.cc) ? body.cc : String(body.cc ?? "").split(/[;,]/)).map((s) => String(s).trim()).filter(Boolean);
      // Dateien kommen als Verweis auf den Speicher — nie als Rohdaten durch die App
      const dateien = Array.isArray(body.dateien) ? body.dateien as { bucket: string; pfad: string; name?: string }[] : [];

      const anhaenge: { name: string; typ: string; daten: Uint8Array }[] = [];
      for (const d of dateien.slice(0, 10)) {
        const { data, error } = await admin.storage.from(d.bucket).download(d.pfad);
        if (error || !data) return json({ error: `Anhang nicht gefunden: ${d.pfad}` }, 400);
        anhaenge.push({ name: d.name || d.pfad.split("/").pop() || "Anhang", typ: data.type || "application/octet-stream", daten: new Uint8Array(await data.arrayBuffer()) });
      }
      const gesamt = anhaenge.reduce((s, a) => s + a.daten.length, 0);
      const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
      const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a;white-space:pre-wrap">${
        textRoh.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`;
      const empfaenger = (liste: string[]) => liste.map((a) => ({ emailAddress: { address: a } }));

      if (gesamt < 3 * 1024 * 1024) {
        // Kleine Mail: in einem Rutsch verschicken
        await graph(tok, `/users/${mb}/sendMail`, {
          method: "POST",
          body: JSON.stringify({
            message: {
              subject: betreff, body: { contentType: "HTML", content: html },
              toRecipients: empfaenger(an), ccRecipients: empfaenger(kopien),
              attachments: anhaenge.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.typ, contentBytes: b64(a.daten) })),
            },
            saveToSentItems: true,
          }),
        });
      } else {
        // Große Anhänge: Entwurf anlegen, stückweise hochladen, dann senden
        const entwurf = await graph<{ id: string }>(tok, `/users/${mb}/messages`, {
          method: "POST",
          body: JSON.stringify({ subject: betreff, body: { contentType: "HTML", content: html }, toRecipients: empfaenger(an), ccRecipients: empfaenger(kopien) }),
        });
        for (const a of anhaenge) {
          const sitzung = await graph<{ uploadUrl: string }>(tok, `/users/${mb}/messages/${entwurf.id}/attachments/createUploadSession`, {
            method: "POST",
            body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: a.name, size: a.daten.length, contentType: a.typ } }),
          });
          const stueck = 4 * 1024 * 1024;
          for (let von = 0; von < a.daten.length; von += stueck) {
            const bis = Math.min(von + stueck, a.daten.length);
            const res = await fetch(sitzung.uploadUrl, {
              method: "PUT",
              headers: { "Content-Length": String(bis - von), "Content-Range": `bytes ${von}-${bis - 1}/${a.daten.length}` },
              body: a.daten.subarray(von, bis),
            });
            if (!res.ok && res.status !== 201 && res.status !== 200) throw new Error(`Anhang ${a.name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
          }
        }
        await graph(tok, `/users/${mb}/messages/${entwurf.id}/send`, { method: "POST" });
      }

      // Beleg als gesendet vermerken (Angebot, Rechnung …)
      if (body.beleg_id) await admin.from("belege").update({ gesendet_am: new Date().toISOString(), status: "gesendet" }).eq("id", String(body.beleg_id)).eq("status", "festgeschrieben");
      return json({ ok: true, an, anhaenge: anhaenge.length, gesendet_von: decodeURIComponent(mb), gesendet_durch: benutzerId });
    }

    // ── Kalender (nur lesen) ──────────────────────────────────────────────
    if (aktion === "kalender") {
      const von = String(body.von ?? url.searchParams.get("von") ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
      const bis = String(body.bis ?? url.searchParams.get("bis") ?? new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10));
      const felder = "id,subject,bodyPreview,start,end,isAllDay,location,attendees,organizer,categories,showAs,webLink,seriesMasterId,type";
      const termine: unknown[] = [];
      let next: string | null = `${GRAPH}/users/${mb}/calendarView?startDateTime=${von}T00:00:00&endDateTime=${bis}T23:59:59&$select=${felder}&$orderby=start/dateTime&$top=200`;
      while (next) {
        const seite: { value: Record<string, unknown>[]; "@odata.nextLink"?: string } =
          await graph(tok, next, { prefer: `outlook.timezone="${ZEITZONE}"` });
        termine.push(...seite.value);
        next = seite["@odata.nextLink"] ?? null;
        if (termine.length > 1000) break;
      }
      return json({ ok: true, von, bis, anzahl: termine.length, termine });
    }

    return json({ error: `Unbekannte Aktion „${aktion}“.` }, 400);
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    console.error("outlook:", text);
    return json({ error: text }, 500);
  }
});
