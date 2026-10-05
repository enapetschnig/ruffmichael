import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Versand über Michaels Microsoft-365-Postfach (wie Angebote/Rechnungen in der Function
// „outlook“): Absender office@ruffinstallateur.at, Kopie in „Gesendete Elemente“.
// Früher Resend — der Schlüssel dafür wurde nie gesetzt, darum ging nichts raus.
const GRAPH = "https://graph.microsoft.com/v1.0";

async function msToken(): Promise<string> {
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

async function graph<T>(tok: string, pfad: string, init?: RequestInit): Promise<T> {
  const kopf: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (init?.body) kopf["Content-Type"] = "application/json";
  const res = await fetch(pfad.startsWith("http") ? pfad : `${GRAPH}${pfad}`, { ...init, headers: kopf });
  if (res.status === 202 || res.status === 204) return {} as T;
  const text = await res.text();
  if (!res.ok) throw new Error(`Outlook ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) as T : {} as T;
}

function postfach(): string {
  const ziel = Deno.env.get("MS_MAIL_TARGET") || Deno.env.get("MS_DRIVE_TARGET") || "";
  if (!ziel.includes("@")) throw new Error("Kein Postfach eingestellt — MS_MAIL_TARGET muss eine E-Mail-Adresse sein.");
  return ziel;
}

/** Mail mit PDF über Outlook senden — große Anhänge (viele Fotos) stückweise hochladen. */
async function perOutlookSenden(opt: { an: string[]; cc: string[]; betreff: string; html: string; dateiname: string; pdfBase64: string }) {
  const tok = await msToken();
  const mb = encodeURIComponent(postfach());
  const empfaenger = (liste: string[]) => liste.map((a) => ({ emailAddress: { address: a } }));
  const bytes = Uint8Array.from(atob(opt.pdfBase64), (c) => c.charCodeAt(0));
  if (bytes.length < 3 * 1024 * 1024) {
    await graph(tok, `/users/${mb}/sendMail`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: opt.betreff, body: { contentType: "HTML", content: opt.html },
          toRecipients: empfaenger(opt.an), ccRecipients: empfaenger(opt.cc),
          attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: opt.dateiname, contentType: "application/pdf", contentBytes: opt.pdfBase64 }],
        },
        saveToSentItems: true,
      }),
    });
    return;
  }
  const entwurf = await graph<{ id: string }>(tok, `/users/${mb}/messages`, {
    method: "POST",
    body: JSON.stringify({ subject: opt.betreff, body: { contentType: "HTML", content: opt.html }, toRecipients: empfaenger(opt.an), ccRecipients: empfaenger(opt.cc) }),
  });
  const sitzung = await graph<{ uploadUrl: string }>(tok, `/users/${mb}/messages/${entwurf.id}/attachments/createUploadSession`, {
    method: "POST",
    body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: opt.dateiname, size: bytes.length, contentType: "application/pdf" } }),
  });
  const stueck = 4 * 1024 * 1024;
  for (let von = 0; von < bytes.length; von += stueck) {
    const bis = Math.min(von + stueck, bytes.length);
    const res = await fetch(sitzung.uploadUrl, {
      method: "PUT",
      headers: { "Content-Length": String(bis - von), "Content-Range": `bytes ${von}-${bis - 1}/${bytes.length}` },
      body: bytes.subarray(von, bis),
    });
    if (!res.ok) throw new Error(`PDF-Anhang: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  await graph(tok, `/users/${mb}/messages/${entwurf.id}/send`, { method: "POST" });
}

// Supabase Admin Client for reading settings
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Material {
  id: string;
  material: string;
  menge: string | null;
  notizen: string | null;
}

interface Photo {
  id: string;
  file_path: string;
  file_name: string;
}

interface Disturbance {
  id: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  stunden: number;
  kunde_name: string;
  kunde_email: string | null;
  kunde_adresse: string | null;
  kunde_telefon: string | null;
  beschreibung: string;
  notizen: string | null;
  unterschrift_kunde: string | null;
  unterschrift_am?: string | null;
}

interface ReportRequest {
  disturbance: Disturbance;
  materials: Material[];
  technicianNames?: string[];
  technicianName?: string; // Legacy support
  photos?: Photo[];
  /** Nur das PDF zurückgeben (Drucken/Teilen in der App) — auch ohne Unterschrift, ohne Versand */
  nurPdf?: boolean;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("Failed to fetch image:", url, response.status);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error("Error fetching image:", error);
    return null;
  }
}

// ── PDF im Aufbau von Michaels Papierformular ─────────────────────────────
// „AUFTRAG UND ARBEITSBESTÄTIGUNG für REGIELEISTUNG“: Kopf (Logo, Telefon, Adresse),
// Monteur/Helfer, Kundendaten, Beschreibung, Stundentabelle mit Unterschrift +
// ACHTUNG-Hinweis, Material-Linien, unten Datum/Unterschrift. Leere Zeilen bleiben
// stehen, damit das Blatt auch ausgedruckt und von Hand ergänzt werden kann.

const ACHTUNG_TEXT =
  "Die werten Kunden werden ersucht, Stundennachweis und Materialaufstellung genau zu kontrollieren, " +
  "da spätere Reklamationen nicht berücksichtigt werden können. Auf beigestellte Artikel geben wir keine " +
  "Garantie und keine Gewährleistung. Auf beigestellte Artikel werden 15% vom Listenpreis als " +
  "Anschlusskosten verrechnet.";

/** „+43 699 14330708“ → „0699/ 143 307 08“ (wie auf dem Formular). */
function telefonAnzeige(roh: string): string[] {
  const ziffern = roh.replace(/[^\d+]/g, "").replace(/^\+43/, "0").replace(/^0043/, "0");
  const m = ziffern.match(/^(0\d{3})(\d+)$/);
  if (!m) return [roh];
  const rest = m[2].replace(/(\d{3})(?=\d{2,})/g, "$1 ").trim();
  return [`${m[1]}/`, rest];
}

/** Kundenname in Vor-/Nachname teilen — Firmen bleiben ganz im Nachnamen. */
function nameTeilen(name: string): { vorname: string; nachname: string } {
  const t = name.trim().replace(/\s+/g, " ");
  if (/\b(gmbh|og|kg|ag|e\.u\.|gesmbh|gesellschaft|firma|verein|gemeinde)\b/i.test(t) || !t.includes(" ")) return { vorname: "", nachname: t };
  const teile = t.split(" ");
  return { vorname: teile.slice(0, -1).join(" "), nachname: teile[teile.length - 1] };
}

const stundenText = (h: number) => `${h.toFixed(2).replace(".", ",")} h`;
const datumKurz = (iso: string) => { const [j, m, t] = String(iso).slice(0, 10).split("-"); return `${t}.${m}.${j}`; };

async function generatePDF(data: ReportRequest & { technicians: string[] }, photoImages: (string | null)[]): Promise<string> {
  const { disturbance, materials, technicians, photos } = data;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const L = 12, R = 198, B = R - L;          // Ränder links/rechts, Breite
  const schwarz = () => doc.setTextColor(0, 0, 0);

  // Firmendaten aus der App (Admin → Angebote & Rechnungen), mit Rückfall auf das Formular
  const { data: firma } = await supabaseAdmin.from("faktura_firmendaten").select("strasse, plz_ort, telefon, email, web").eq("einzig", true).maybeSingle();
  const adresse = [firma?.strasse || "Maria Theresienstr. 21-23", firma?.plz_ort || "2601 Eggendorf/SMT", firma?.email || "office@ruffinstallateur.at", firma?.web || "www.ruffinstallateur.at"];
  const telefon = telefonAnzeige(firma?.telefon || "0699 14330708");

  /** Text, der in eine Breite passen muss — sonst gekürzt. */
  const passend = (t: string, breite: number) => {
    let x = t;
    while (x.length > 1 && doc.getTextWidth(x) > breite) x = x.slice(0, -1);
    return x.length < t.length ? x.slice(0, -1) + "…" : x;
  };
  /** „Label: Wert“ mit Schreiblinie bis `bis` (wie die Linien auf dem Formular). */
  const feld = (label: string, wert: string, x: number, y: number, bis: number) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); schwarz();
    doc.text(label, x, y);
    const start = x + doc.getTextWidth(label) + 2;
    doc.setLineWidth(0.2); doc.setDrawColor(60, 60, 60);
    doc.line(start, y + 0.8, bis, y + 0.8);
    if (wert) { doc.setFont("helvetica", "bold"); doc.text(passend(wert, bis - start - 1), start + 1, y - 0.3); }
  };

  // ── Kopf ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  try {
    const logo = await fetch(`${supabaseUrl}/storage/v1/object/public/branding/ruff-logo.png`);
    if (logo.ok) {
      const u = new Uint8Array(await logo.arrayBuffer());
      let bin = ""; for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
      doc.addImage(`data:image/png;base64,${btoa(bin)}`, "PNG", L, 9, 50, 32);
    }
  } catch (e) { console.error("Logo:", e); }
  doc.setFont("helvetica", "bold"); doc.setFontSize(21); schwarz();
  telefon.forEach((z, i) => doc.text(z, 107, 22 + i * 9, { align: "center" }));
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  adresse.forEach((z, i) => doc.text(z, R, 16 + i * 6, { align: "right" }));

  // ── Titel ──
  let y = 50;
  doc.setFont("helvetica", "bold"); doc.setFontSize(13.5);
  const t1 = "AUFTRAG UND ARBEITSBESTÄTIGUNG", t2 = "für", t3 = "REGIELEISTUNG";
  const w1 = doc.getTextWidth(t1), w3 = doc.getTextWidth(t3);
  doc.setFontSize(12); const w2 = doc.getTextWidth(t2); doc.setFontSize(13.5);
  const luecke = 2.2; // Abstand zwischen den drei Teilen (Leerzeichen am Ende misst jsPDF nicht verlässlich)
  let tx = (210 - (w1 + w2 + w3 + 2 * luecke)) / 2;
  doc.text(t1, tx, y); tx += w1 + luecke;
  doc.setFontSize(12); doc.text(t2, tx, y); tx += w2 + luecke;
  doc.setFontSize(13.5); doc.text(t3, tx, y);

  // ── Monteur / Helfer ──
  const monteur = technicians[0] && technicians[0] !== "Techniker" ? technicians[0] : "";
  const helfer = technicians.slice(1);
  doc.setLineWidth(0.6); doc.setDrawColor(0, 0, 0);
  doc.rect(L, 53, B, 9);
  feld("Monteur:", monteur, L + 3, 59.5, 104);
  feld("Helfer:", helfer.join(", "), 108, 59.5, R - 3);

  // ── Kunde ──
  doc.setLineWidth(0.6); doc.setDrawColor(0, 0, 0);
  doc.rect(L, 62, B, 26);
  const n = nameTeilen(disturbance.kunde_name || "");
  feld("Vorname:", n.vorname, L + 3, 68.5, 104);
  feld("Nachname:", n.nachname, 108, 68.5, R - 3);
  feld("Anschrift:", disturbance.kunde_adresse || "", L + 3, 76, R - 3);
  feld("Telefon:", disturbance.kunde_telefon || "", L + 3, 84, 104);
  feld("E-Mail:", disturbance.kunde_email || "", 108, 84, R - 3);

  // ── Beschreibung der Kundenbestellung ──
  y = 96;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); schwarz();
  const bLabel = "Beschreibung der Kundenbestellung:";
  doc.text(bLabel, L, y);
  const bStart = L + doc.getTextWidth(bLabel) + 2;
  const beschreibung = [disturbance.beschreibung, disturbance.notizen ? `Notiz: ${disturbance.notizen}` : ""].filter(Boolean).join("\n");
  doc.setFont("helvetica", "bold");
  // erste Zeile neben dem Label, weitere über die volle Breite
  const ersteBreite = R - bStart - 1;
  const woerter = beschreibung.replace(/\n/g, " \n ").split(" ");
  let erste = "", i = 0;
  for (; i < woerter.length; i++) {
    if (woerter[i] === "\n") { i++; break; }
    const probe = erste ? `${erste} ${woerter[i]}` : woerter[i];
    if (doc.getTextWidth(probe) > ersteBreite) break;
    erste = probe;
  }
  const restText = woerter.slice(i).join(" ").replace(/ \n /g, "\n").trim();
  const weitere = restText ? doc.splitTextToSize(restText, B - 2) as string[] : [];
  const maxZeilen = 6;
  const zuLang = weitere.length > maxZeilen;
  if (zuLang) weitere[maxZeilen - 1] = passend(weitere[maxZeilen - 1] + " …", B - 30) + "  (vollständig auf Seite 2)";
  const bZeilen = Math.max(1, Math.min(weitere.length, maxZeilen));   // mindestens eine Leerzeile wie am Formular
  doc.setLineWidth(0.2); doc.setDrawColor(60, 60, 60);
  doc.line(bStart, y + 0.8, R, y + 0.8);
  if (erste) doc.text(erste, bStart + 1, y - 0.3);
  for (let z = 0; z < bZeilen; z++) {
    const zy = y + 7 * (z + 1);
    doc.line(L, zy + 0.8, R, zy + 0.8);
    if (weitere[z]) doc.text(weitere[z], L + 1, zy - 0.3);
  }
  y += 7 * bZeilen + 7;

  // ── Stundentabelle ──
  const cDatum = 22, cMont = 23, cHelf = 23, cUnt = 60;
  const xD = L, xM = xD + cDatum, xH = xM + cMont, xU = xH + cHelf, xEnde = xU + cUnt;
  const kopf1 = 6, kopf2 = 5.5, zeileH = 9, zeilen = 8, gesamtH = 8;
  const top = y;
  doc.setLineWidth(0.6); doc.setDrawColor(0, 0, 0);
  const hoehe = kopf1 + kopf2 + zeileH * zeilen + gesamtH;
  doc.rect(xD, top, xEnde - xD, hoehe);
  // senkrechte Linien
  doc.line(xM, top, xM, top + hoehe);
  doc.line(xU, top, xU, top + hoehe);
  doc.setLineWidth(0.3); doc.line(xH, top + kopf1, xH, top + hoehe);
  // waagrechte Linien
  doc.setLineWidth(0.3); doc.line(xM, top + kopf1, xU, top + kopf1);
  doc.setLineWidth(0.6); doc.line(xD, top + kopf1 + kopf2, xEnde, top + kopf1 + kopf2);
  doc.setLineWidth(0.2);
  for (let z = 1; z < zeilen; z++) doc.line(xD, top + kopf1 + kopf2 + z * zeileH, xEnde, top + kopf1 + kopf2 + z * zeileH);
  const gesamtY = top + kopf1 + kopf2 + zeilen * zeileH;
  doc.setLineWidth(0.6); doc.line(xD, gesamtY, xEnde, gesamtY);
  // Köpfe
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); schwarz();
  doc.text("Datum", xD + cDatum / 2, top + 7, { align: "center" });
  doc.text("Arbeitszeit inkl. Wegzeit", xM + (cMont + cHelf) / 2, top + 4.3, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.text("Monteur", xM + cMont / 2, top + kopf1 + 4, { align: "center" });
  doc.text("Helfer", xH + cHelf / 2, top + kopf1 + 4, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.text("Unterschrift des Kunden", xU + cUnt / 2, top + 7, { align: "center" });
  doc.text("Gesamt", xD + 2, gesamtY + 5.5);
  // Eintrag des Einsatzes (erste Zeile)
  const h = Number(disturbance.stunden) || 0;
  const z1 = top + kopf1 + kopf2;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  doc.text(datumKurz(disturbance.datum), xD + cDatum / 2, z1 + 5.8, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.text(stundenText(h), xM + cMont / 2, z1 + 4.6, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7);
  const von = disturbance.start_time.slice(0, 5), bis = disturbance.end_time.slice(0, 5);
  // nur einfache Zeichen — „−“ oder „′“ kennt die Standardschrift nicht, die Zeile zerfiele
  doc.text(`${von}-${bis}${disturbance.pause_minutes > 0 ? ` (P ${disturbance.pause_minutes}')` : ""}`, xM + cMont / 2, z1 + 7.8, { align: "center" });
  if (helfer.length) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
    doc.text(helfer.length > 1 ? `${helfer.length} × ${stundenText(h)}` : stundenText(h), xH + cHelf / 2, z1 + 4.6, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text(`${von}-${bis}`, xH + cHelf / 2, z1 + 7.8, { align: "center" });
  }
  // Unterschrift nur einmal — unten bei Datum/Unterschrift (Wunsch Michael, 05.10.2026)
  // Gesamt
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
  doc.text(stundenText(h), xM + cMont / 2, gesamtY + 5.5, { align: "center" });
  if (helfer.length) doc.text(stundenText(h * helfer.length), xH + cHelf / 2, gesamtY + 5.5, { align: "center" });

  // ACHTUNG-Hinweis rechts neben der Tabelle
  const ax = xEnde + 3, aw = R - ax;
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); schwarz();
  doc.text("ACHTUNG!", ax, top + 32);
  doc.setFontSize(7.6);
  doc.text(doc.splitTextToSize(ACHTUNG_TEXT, aw) as string[], ax, top + 38, { lineHeightFactor: 1.35 });

  // ── Verwendetes Material ──
  y = top + hoehe + 9;
  const fussY = 284;
  const matZeilen = (materials ?? []).map((m) => [m.material, m.menge ? `– ${m.menge}` : "", m.notizen ? `(${m.notizen})` : ""].filter(Boolean).join(" "));
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); schwarz();
  const mLabel = "Verwendetes Material:";
  doc.text(mLabel, L, y);
  const mStart = L + doc.getTextWidth(mLabel) + 2;
  doc.setLineWidth(0.2); doc.setDrawColor(60, 60, 60);
  doc.line(mStart, y + 0.8, R, y + 0.8);
  doc.setFont("helvetica", "bold");
  let mi = 0;
  if (matZeilen[0]) { doc.text(passend(matZeilen[0], R - mStart - 1), mStart + 1, y - 0.3); mi = 1; }
  let my = y + 7;
  const zeileMaterial = (text?: string) => {
    doc.setLineWidth(0.2); doc.setDrawColor(60, 60, 60);
    doc.line(L, my + 0.8, R, my + 0.8);
    if (text) { doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); schwarz(); doc.text(passend(text, B - 2), L + 1, my - 0.3); }
    my += 7;
  };
  // Linien bis zum Fuß; mehr Material → Folgeseite
  while (my < fussY - 14) zeileMaterial(matZeilen[mi++]);
  if (mi < matZeilen.length) {
    // Rest auf eine Folgeseite, der Fuß kommt danach dort hin
    doc.setFontSize(8); doc.setFont("helvetica", "italic"); doc.setTextColor(90, 90, 90);
    doc.text("Fortsetzung Material auf der nächsten Seite", L, my - 2);
    doc.addPage();
    my = 20;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); schwarz();
    doc.text("Verwendetes Material (Fortsetzung):", L, my - 6);
    while (mi < matZeilen.length) {
      if (my > fussY - 14) { doc.addPage(); my = 20; }
      zeileMaterial(matZeilen[mi++]);
    }
  }
  doc.setLineWidth(0.6); doc.setDrawColor(0, 0, 0);
  doc.line(L, fussY - 9, R, fussY - 9);

  // ── Fuß: Datum / Unterschrift ──
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
  doc.text("Mit der Unterschrift wird der Auftrag für die angeführten Regieleistungen erteilt und deren ordnungsgemäße Durchführung bestätigt.", L, fussY - 5);
  schwarz(); doc.setFontSize(10);
  doc.text("Datum", L, fussY + 6);
  doc.setLineWidth(0.2); doc.setDrawColor(60, 60, 60);
  doc.line(L + 12, fussY + 6.8, 80, fussY + 6.8);
  const unterschriftAm = (disturbance as { unterschrift_am?: string | null }).unterschrift_am;
  if (disturbance.unterschrift_kunde) {
    doc.setFont("helvetica", "bold");
    doc.text(datumKurz(unterschriftAm || disturbance.datum), L + 14, fussY + 5.7);
    doc.setFont("helvetica", "normal");
  }
  doc.text("Unterschrift", 112, fussY + 6);
  doc.line(133, fussY + 6.8, R, fussY + 6.8);
  if (disturbance.unterschrift_kunde) {
    try { doc.addImage(disturbance.unterschrift_kunde, "PNG", 140, fussY - 4, 32, 10.5); } catch (e) { console.error("Unterschrift Fuß:", e); }
  }

  // ── Zu lange Beschreibung: vollständiger Text auf eigener Seite ──
  if (zuLang) {
    doc.addPage();
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); schwarz();
    doc.text("Beschreibung der Kundenbestellung (vollständig)", L, 18);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
    let by = 27;
    for (const zeile of doc.splitTextToSize(beschreibung, B) as string[]) {
      if (by > 285) { doc.addPage(); by = 18; }
      doc.text(zeile, L, by); by += 5.5;
    }
  }

  // ── Fotos (eigene Seiten) ──
  if (photos && photos.length > 0 && photoImages.some((img) => img !== null)) {
    doc.addPage();
    let py = 18;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); schwarz();
    doc.text(`Fotos – ${disturbance.kunde_name} – ${datumKurz(disturbance.datum)}`, L, py);
    py += 8;
    for (let k = 0; k < photos.length; k++) {
      const bild = photoImages[k];
      if (!bild) continue;
      if (py > 215) { doc.addPage(); py = 18; }
      try {
        doc.addImage(bild, "JPEG", L, py, 90, 67);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
        doc.text(photos[k].file_name, L, py + 71);
        schwarz();
        py += 77;
      } catch (e) { console.error("Foto:", e); }
    }
  }

  return doc.output("datauristring").split(",")[1];
}

function generateEmailHtml(data: ReportRequest & { technicians: string[] }): string {
  const { disturbance, technicians } = data;
  const technicianDisplay = technicians.length === 1 ? technicians[0] : technicians.join(", ");
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #333; line-height: 1.5; }
        .header { color: #F07002; font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .info-box { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">Ruff Michael GmbH</div>
        <h2>Auftrag und Arbeitsbestätigung für Regieleistung</h2>
        
        <p>Sehr geehrte Damen und Herren,</p>
        
        <p>im Anhang finden Sie Auftrag und Arbeitsbestätigung für die Regieleistung bei <strong>${disturbance.kunde_name}</strong> vom <strong>${formatDate(disturbance.datum)}</strong>.</p>
        
        <div class="info-box">
          <strong>Zusammenfassung:</strong><br>
          Techniker: ${technicianDisplay}<br>
          Arbeitszeit: ${disturbance.start_time.slice(0, 5)} - ${disturbance.end_time.slice(0, 5)} Uhr<br>
          Gesamtstunden: ${disturbance.stunden.toFixed(2)} h
        </div>
        
        <p>Das vollständige Dokument mit allen Details und der Kundenunterschrift befindet sich im angehängten PDF.</p>
        
        <p>Mit freundlichen Grüßen,<br>
        Ruff Michael GmbH – Wärme, Kälte, Regelung</p>
      </div>
    </body>
    </html>
  `;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { disturbance, materials, technicianNames, technicianName, photos, nurPdf }: ReportRequest = await req.json();

    // Backward compatibility + fallback
    const technicians = technicianNames?.length ? technicianNames : 
                        technicianName ? [technicianName] : ["Techniker"];

    if (!disturbance || (!nurPdf && !disturbance.unterschrift_kunde)) {
      return new Response(
        JSON.stringify({ error: "Disturbance data and signature required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Generating PDF for disturbance:", disturbance.id);

    // Fetch photo images from storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const photoImages: (string | null)[] = [];
    if (photos && photos.length > 0) {
      console.log(`Fetching ${photos.length} photos...`);
      for (const photo of photos) {
        const photoUrl = `${supabaseUrl}/storage/v1/object/public/disturbance-photos/${photo.file_path}`;
        const imageData = await fetchImageAsBase64(photoUrl);
        photoImages.push(imageData);
      }
    }

    // Generate PDF
    const pdfBase64 = await generatePDF({ disturbance, materials, technicians, photos }, photoImages);

    // Nur Drucken/Teilen: PDF zurückgeben, nichts versenden, Status unverändert
    if (nurPdf) {
      return new Response(
        JSON.stringify({ pdf: pdfBase64 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate simple email HTML
    const emailHtml = generateEmailHtml({ disturbance, materials, technicians });

    // Empfänger: der Kunde (falls E-Mail hinterlegt). Das Firmenpostfach office@ bekommt
    // IMMER eine Kopie in den Posteingang — nicht nur in „Gesendete Elemente“. Dazu die
    // Adresse aus der Einstellung „Regiebericht E-Mail-Empfänger“, falls eine andere.
    const { data: setting } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "disturbance_report_email")
      .maybeSingle();
    const buero = String(setting?.value ?? "").trim();
    const absender = postfach().toLowerCase();
    const kunde = String(disturbance.kunde_email ?? "").trim();
    const an = kunde ? [kunde] : [absender];
    const cc = [...new Set([absender, buero.toLowerCase()].filter((x) => x && !an.some((a) => a.toLowerCase() === x)))];

    const dateForFilename = formatDateShort(disturbance.datum).replace(/\./g, "-");
    const kundeForFilename = disturbance.kunde_name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "_");
    const pdfFilename = `Auftrag_Arbeitsbestaetigung_${kundeForFilename}_${dateForFilename}.pdf`;
    const subject = `Auftrag und Arbeitsbestätigung für Regieleistung - ${disturbance.kunde_name} - ${formatDateShort(disturbance.datum)}`;

    console.log("Sende Arbeitsbestätigung über Outlook an:", an, "Kopie:", cc);
    await perOutlookSenden({ an, cc, betreff: subject, html: emailHtml, dateiname: pdfFilename, pdfBase64 });
    const emailResponse = { an, cc, von: absender };

    console.log("Email sent successfully:", emailResponse);

    // Status erst NACH bestätigtem Versand setzen (einzige Quelle der Wahrheit,
    // gilt online wie beim Offline-Sync).
    await supabaseAdmin.from("disturbances").update({ status: "gesendet", pdf_gesendet_am: new Date().toISOString() }).eq("id", disturbance.id);

    return new Response(
      JSON.stringify({ success: true, emailResponse }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error sending disturbance report:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
