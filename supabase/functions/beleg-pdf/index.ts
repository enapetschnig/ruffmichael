// PDF für Angebote, Rechnungen, Gutschriften.
//
// Aufruf (nur Administratoren): POST { belegId, neu?: boolean }
//  * Entwurf → nur Vorschau (base64), nichts wird gespeichert. So landet kein
//    Entwurf in Michaels OneDrive.
//  * Festgeschrieben, noch nicht gesendet → PDF wird (neu) erzeugt und im
//    Projektordner „Anbote" abgelegt (project-files/{projekt}/Anbote/…, der
//    OneDrive-Sync trägt es hinüber), pdf_pfad am Beleg gesetzt.
//  * Festgeschrieben UND bereits gesendet (Rechnung/Gutschrift) → das
//    archivierte PDF wird NICHT mehr überschrieben, es kommt nur die signierte
//    URL des vorhandenen Dokuments zurück. Was der Kunde bekommen hat, bleibt.
//    Angebote dürfen weiter nachbearbeitet werden — dort wird ersetzt.
//
// Pflichtangaben nach § 11 UStG sind fest eingebaut: Name/Anschrift beider
// Seiten, UID bei Reverse Charge, fortlaufende Nummer, Datum, Leistungszeitraum,
// Entgelt, Steuersatz/-betrag bzw. Hinweis auf den Übergang der Steuerschuld.

import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TYP_LABEL: Record<string, string> = {
  angebot: "Angebot",
  auftragsbestaetigung: "Auftragsbestätigung",
  rechnung: "Rechnung",
  teilrechnung: "Teilrechnung",
  schlussrechnung: "Schlussrechnung",
  gutschrift: "Gutschrift",
};
const TYP_DATEINAME: Record<string, string> = {
  angebot: "Unverbindliches Angebot",
  auftragsbestaetigung: "Auftragsbestätigung",
  rechnung: "Rechnung",
  teilrechnung: "Teilrechnung",
  schlussrechnung: "Schlussrechnung",
  gutschrift: "Gutschrift",
};
const RECHNUNGSARTEN = ["rechnung", "teilrechnung", "schlussrechnung", "gutschrift"];

const eur = (n: number | string | null) =>
  new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));
const zahl = (n: number | string | null) =>
  new Intl.NumberFormat("de-AT", { maximumFractionDigits: 3 }).format(Number(n ?? 0));
const datum = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
};
const transliterate = (s: string) =>
  s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
   .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss");
// Supabase-Storage erlaubt nur \w / ! - . * ' ( ) Leerzeichen & $ @ = ; : + , ?
const safeKey = (s: string) => transliterate(s).replace(/[^\w !\-.*'()&$@=;:+,?]/g, "_");

async function logoBase64(supabaseUrl: string): Promise<string | null> {
  try {
    const r = await fetch(`${supabaseUrl}/storage/v1/object/public/branding/ruff-logo.png`);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:image/png;base64,${btoa(bin)}`;
  } catch { return null; }
}

// deno-lint-ignore no-explicit-any
function render(b: any, positionen: any[], f: any, kundennr: string | null, projektName: string | null, logo: string | null): ArrayBuffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 20;
  const R = W - M;
  const FOOT_Y = H - 22;
  const MAX_Y = FOOT_Y - 10;
  const LH = 4.3; // Zeilenhöhe in der Tabelle
  const titel = `${TYP_LABEL[b.typ] ?? b.typ} ${b.nummer ?? "— ENTWURF —"}`;

  const fuss = () => {
    const seite = doc.getNumberOfPages();
    doc.setDrawColor(180); doc.setLineWidth(0.3); doc.line(M, FOOT_Y, R, FOOT_Y);
    doc.setFontSize(7.5); doc.setTextColor(90); doc.setFont("helvetica", "normal");
    const c1 = [f.firma, f.strasse, f.plz_ort, f.telefon ? `Tel. ${f.telefon}` : null, f.email].filter(Boolean) as string[];
    const c2 = [f.uid ? `UID ${f.uid}` : null, f.firmenbuch ? `FN ${f.firmenbuch}` : null, f.gericht || null, f.web || null].filter(Boolean) as string[];
    const c3 = [f.bank || null, f.iban ? `IBAN ${f.iban}` : null, f.bic ? `BIC ${f.bic}` : null].filter(Boolean) as string[];
    c1.forEach((t, i) => doc.text(t, M, FOOT_Y + 4 + i * 3.4));
    c2.forEach((t, i) => doc.text(t, M + 60, FOOT_Y + 4 + i * 3.4));
    c3.forEach((t, i) => doc.text(t, M + 115, FOOT_Y + 4 + i * 3.4));
    doc.text(`${titel} · Seite ${seite}`, R, FOOT_Y + 4, { align: "right" });
    doc.setTextColor(0);
  };
  const neueSeite = () => { fuss(); doc.addPage(); return M + 10; };

  // ── Kopf ──────────────────────────────────────────────────────────────
  let y = M;
  if (logo) { try { doc.addImage(logo, "PNG", M, y - 2, 46, 30); } catch { /* ohne Logo */ } }
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(0);
  doc.text(f.firma || "Ruff Michael GmbH", R, y + 4, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(70);
  [f.zusatz, f.strasse, f.plz_ort, f.telefon ? `Tel. ${f.telefon}` : null, f.email, f.web]
    .filter(Boolean).forEach((t: string, i: number) => doc.text(t, R, y + 9 + i * 4, { align: "right" }));
  doc.setTextColor(0);

  // Absenderzeile + Empfänger (Fensterkuvert-Position); Meta-Block rechts
  y = 50;
  doc.setFontSize(7); doc.setTextColor(110);
  doc.text([f.firma, f.strasse, f.plz_ort].filter(Boolean).join(" · "), M, y);
  doc.setDrawColor(200); doc.line(M, y + 1.2, M + 85, y + 1.2);
  doc.setTextColor(0); doc.setFontSize(10.5);
  const empfBreite = 95; // lange Firmennamen werden umbrochen, nicht in den Meta-Block geschoben
  const empf: string[] = [];
  for (const t of [b.kunde_name, b.kunde_zusatz, b.kunde_strasse, b.kunde_plz_ort]) {
    if (t) empf.push(...doc.splitTextToSize(String(t), empfBreite));
  }
  empf.forEach((t, i) => doc.text(t, M, y + 7 + i * 5));
  if (b.kunde_uid) { doc.setFontSize(9); doc.text(`UID ${b.kunde_uid}`, M, y + 7 + empf.length * 5); doc.setFontSize(10.5); }

  const meta: [string, string][] = [];
  meta.push(["Datum", datum(b.datum)]);
  if (kundennr) meta.push(["Kundennr.", kundennr]);
  if (b.leistung_von || b.leistung_bis) {
    meta.push(["Leistung", b.leistung_von && b.leistung_bis && b.leistung_von !== b.leistung_bis
      ? `${datum(b.leistung_von)} – ${datum(b.leistung_bis)}` : datum(b.leistung_von || b.leistung_bis)]);
  }
  if (projektName) meta.push(["Projekt", projektName]);
  if (b.vorgaenger_nummer) meta.push([b.typ === "gutschrift" ? "zu Rechnung" : "Bezug", b.vorgaenger_nummer]);
  if (b.gueltig_bis && b.typ === "angebot") meta.push(["Gültig bis", datum(b.gueltig_bis)]);
  if (b.faellig_am && ["rechnung", "teilrechnung", "schlussrechnung"].includes(b.typ)) meta.push(["Zahlbar bis", datum(b.faellig_am)]);
  doc.setFontSize(9);
  meta.forEach(([k, v], i) => {
    const wert = doc.splitTextToSize(String(v), 48)[0]; // nie in die Beschriftung laufen
    doc.setTextColor(110); doc.text(k, R - 52, y + 7 + i * 4.6);
    doc.setTextColor(0); doc.text(wert, R, y + 7 + i * 4.6, { align: "right" });
  });

  // ── Titel + Einleitung ────────────────────────────────────────────────
  y = Math.max(96, y + 7 + Math.max(empf.length + (b.kunde_uid ? 1 : 0), meta.length) * 5 + 8);
  doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text(titel, M, y);
  if (b.betreff) { doc.setFontSize(11); y += 6.5; doc.text(doc.splitTextToSize(String(b.betreff), R - M), M, y); }
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  y += 8;
  if (b.einleitung) {
    const lines = doc.splitTextToSize(String(b.einleitung), R - M);
    if (y + lines.length * 4.6 > MAX_Y) y = neueSeite();
    doc.text(lines, M, y); y += lines.length * 4.6 + 3;
  }

  // ── Positionen ────────────────────────────────────────────────────────
  const col = { pos: M, text: M + 10, menge: M + 108, einheit: M + 112, einzel: M + 146, gesamt: R };
  const textBreite = 92;
  const kopf = () => {
    doc.setFillColor(238); doc.rect(M, y - 4.2, R - M, 6.2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(60);
    doc.text("Pos.", col.pos + 1, y); doc.text("Bezeichnung", col.text, y);
    doc.text("Menge", col.menge, y, { align: "right" }); doc.text("Einh.", col.einheit, y);
    doc.text("Einzelpreis", col.einzel, y, { align: "right" }); doc.text("Betrag", col.gesamt, y, { align: "right" });
    doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    y += 6;
  };
  kopf();
  let nr = 0;
  for (const p of positionen) {
    const textLines: string[] = doc.splitTextToSize(String(p.text || ""), textBreite);
    const beschr: string[] = p.beschreibung ? doc.splitTextToSize(String(p.beschreibung), textBreite) : [];
    const hatRabatt = p.art === "position" && Number(p.rabatt_prozent) > 0;
    // Kopfzeile der Position (Text + Zahlen) muss auf die Seite passen
    if (y + textLines.length * LH + 2 > MAX_Y) { y = neueSeite(); kopf(); }
    if (p.art === "ueberschrift") {
      doc.setFont("helvetica", "bold"); doc.text(textLines, col.text, y); doc.setFont("helvetica", "normal");
    } else if (p.art === "text") {
      doc.setTextColor(70); doc.text(textLines, col.text, y); doc.setTextColor(0);
    } else {
      nr += 1;
      doc.text(String(nr), col.pos + 1, y);
      doc.text(textLines, col.text, y);
      doc.text(zahl(p.menge), col.menge, y, { align: "right" });
      doc.text(String(p.einheit ?? ""), col.einheit, y);
      doc.text(eur(p.einzelpreis), col.einzel, y, { align: "right" });
      doc.text(eur(p.gesamt), col.gesamt, y, { align: "right" });
    }
    y += textLines.length * LH;
    // Beschreibung blockweise — auch sehr lange Texte laufen nie in die Fußzeile
    if (beschr.length) {
      doc.setFontSize(8.5); doc.setTextColor(90);
      let rest = beschr;
      while (rest.length) {
        const frei = Math.floor((MAX_Y - y) / LH);
        if (frei < 2) { y = neueSeite(); kopf(); doc.setFontSize(8.5); doc.setTextColor(90); continue; }
        const teil = rest.slice(0, frei);
        doc.text(teil, col.text, y); y += teil.length * LH; rest = rest.slice(frei);
      }
      doc.setTextColor(0); doc.setFontSize(9.5);
    }
    if (hatRabatt) {
      if (y + 3.5 > MAX_Y) { y = neueSeite(); kopf(); }
      doc.setFontSize(7.5); doc.setTextColor(110);
      doc.text(`abzgl. ${zahl(p.rabatt_prozent)} % Rabatt`, col.text, y);
      doc.setTextColor(0); doc.setFontSize(9.5); y += 3.5;
    }
    // Trennlinie knapp unter der Position
    const unten = y - LH + 1.6;
    doc.setDrawColor(225); doc.line(M, unten, R, unten);
    y = unten + 4.6;
  }

  // ── Summen ────────────────────────────────────────────────────────────
  if (y + 40 > MAX_Y) y = neueSeite();
  y += 4;
  const sumX = M + 88;
  const sumZeile = (k: string, v: string, fett = false) => {
    doc.setFont("helvetica", fett ? "bold" : "normal"); doc.setFontSize(fett ? 11 : 9.5);
    doc.text(k, sumX, y, { align: "left" }); doc.text(v, col.gesamt, y, { align: "right" }); y += fett ? 6.5 : 5.2;
  };
  const istRe = ["rechnung", "teilrechnung", "schlussrechnung"].includes(b.typ);
  sumZeile("Summe netto", eur(b.netto));
  if (b.reverse_charge) sumZeile("Umsatzsteuer (Übergang der Steuerschuld)", "entfällt");
  else sumZeile(`zzgl. ${zahl(b.ust_satz)} % USt`, eur(b.ust));
  doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(sumX, y - 3.5, R, y - 3.5);
  sumZeile(b.typ === "gutschrift" ? "Gutschriftsbetrag" : istRe ? "Rechnungsbetrag" : "Angebotssumme", eur(b.brutto), true);
  doc.setLineWidth(0.2);

  // ── Hinweise / Zahlung ───────────────────────────────────────────────
  y += 3;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  const hinweise: string[] = [];
  if (b.reverse_charge) hinweise.push("Übergang der Steuerschuld gemäß § 19 Abs. 1a UStG (Bauleistung). Die Rechnung enthält keine Umsatzsteuer; Steuerschuldner ist der Leistungsempfänger.");
  if (istRe) {
    const skonto = b.skonto_prozent && b.skonto_tage ? ` — bei Zahlung innerhalb von ${b.skonto_tage} Tagen ${zahl(b.skonto_prozent)} % Skonto` : "";
    hinweise.push(`Zahlbar bis ${datum(b.faellig_am)} ohne Abzug${skonto}.`);
    if (f.iban) hinweise.push(`Bankverbindung: ${[f.bank, `IBAN ${f.iban}`, f.bic ? `BIC ${f.bic}` : null].filter(Boolean).join(", ")} — Verwendungszweck: ${b.nummer ?? titel}.`);
  }
  if (b.typ === "angebot" && b.gueltig_bis) hinweise.push(`Dieses Angebot ist gültig bis ${datum(b.gueltig_bis)}. Preise netto zuzüglich gesetzlicher Umsatzsteuer, sofern nicht anders angegeben.`);
  if (b.typ === "gutschrift") hinweise.push("Der Betrag wird auf das uns bekannte Konto überwiesen bzw. mit offenen Forderungen verrechnet.");
  if (b.schlusstext) hinweise.push(String(b.schlusstext));
  if (f.fusstext) hinweise.push(String(f.fusstext));
  for (const h of hinweise) {
    const lines = doc.splitTextToSize(h, R - M);
    if (y + lines.length * 4.4 > MAX_Y) y = neueSeite();
    doc.text(lines, M, y); y += lines.length * 4.4 + 2.5;
  }
  fuss();
  return doc.output("arraybuffer");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Nur Administratoren
    const auth = req.headers.get("Authorization") ?? "";
    const { data: { user } } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    }).auth.getUser();
    if (!user) return json({ error: "Nicht angemeldet." }, 401);
    const { data: rolle } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "administrator").maybeSingle();
    if (!rolle) return json({ error: "Nur Administratoren dürfen Belege erzeugen." }, 403);

    let body: { belegId?: string } = {};
    try { body = await req.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
    const belegId = body.belegId;
    if (!belegId) return json({ error: "belegId fehlt." }, 400);

    const { data: b, error: e1 } = await admin.from("belege").select("*").eq("id", belegId).single();
    if (e1 || !b) return json({ error: "Beleg nicht gefunden." }, 404);

    // Gesendete Rechnung/Gutschrift: Archiv bleibt unangetastet
    if (b.status !== "entwurf" && b.pdf_pfad && b.gesendet_am && RECHNUNGSARTEN.includes(b.typ)) {
      const { data: signed } = await admin.storage.from("project-files").createSignedUrl(b.pdf_pfad, 3600);
      if (signed?.signedUrl) return json({ pfad: b.pdf_pfad, url: signed.signedUrl, archiv: true });
    }

    const [{ data: positionen }, { data: f }, { data: kunde }, { data: projekt }, { data: vorg }] = await Promise.all([
      admin.from("beleg_positionen").select("*").eq("beleg_id", belegId).order("pos").order("created_at"),
      admin.from("faktura_firmendaten").select("*").eq("einzig", true).single(),
      b.customer_id ? admin.from("customers").select("kundennr").eq("id", b.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      b.project_id ? admin.from("projects").select("name").eq("id", b.project_id).maybeSingle() : Promise.resolve({ data: null }),
      b.vorgaenger_id ? admin.from("belege").select("nummer").eq("id", b.vorgaenger_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const logo = await logoBase64(url);
    const pdf = render({ ...b, vorgaenger_nummer: vorg?.nummer ?? null }, positionen ?? [], f ?? {}, kunde?.kundennr ?? null, projekt?.name ?? null, logo);

    // Entwurf: nur Vorschau, nichts speichern
    if (b.status === "entwurf" || !b.nummer) {
      const bytes = new Uint8Array(pdf); let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return json({ base64: btoa(bin), entwurf: true });
    }

    const dateiname = `${TYP_DATEINAME[b.typ] ?? b.typ} ${b.nummer}.pdf`;
    const pfad = `${b.project_id ?? "_ohne_projekt"}/Anbote/${safeKey(dateiname)}`;
    // Projekt gewechselt (Angebot nachbearbeitet)? Altes PDF nicht liegen lassen.
    if (b.pdf_pfad && b.pdf_pfad !== pfad) await admin.storage.from("project-files").remove([b.pdf_pfad]);
    const { error: up } = await admin.storage.from("project-files")
      .upload(pfad, new Blob([pdf], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
    if (up) return json({ error: `Ablage fehlgeschlagen: ${up.message}` }, 500);
    await admin.from("belege").update({ pdf_pfad: pfad }).eq("id", belegId);
    const { data: signed } = await admin.storage.from("project-files").createSignedUrl(pfad, 3600);
    return json({ pfad, url: signed?.signedUrl ?? null });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
