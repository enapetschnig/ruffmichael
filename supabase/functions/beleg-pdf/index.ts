// PDF für Angebote, Rechnungen, Gutschriften — im Aufbau von Michaels
// bisherigen KingBill-Belegen (Logo links, Firmenname mittig, Adressblock
// rechts, Kundeninfo-Kasten, graue Tabellenköpfe, Übertrag, Bankverbindung
// in der Fußzeile, „Seite x von y“; beim Angebot Auftragsbedingungen,
// Zahlungsweise, Unterschriften und Widerrufsbelehrung).
//
// Aufruf (nur Administratoren): POST { belegId }
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
// Fußzeile nach § 14 UGB: Firma, Sitz, Firmenbuchnummer, Gericht, UID.

import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

const betrag = (n: number | string | null) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0));
const eur = (n: number | string | null) => `€ ${betrag(n)}`;
const zahl = (n: number | string | null) =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(Number(n ?? 0));
const menge2 = (n: number | string | null) => {
  const v = Number(n ?? 0);
  return Number.isInteger(v)
    ? new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
    : new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(v);
};
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
  const M = 18;
  const R = W - M;
  const FOOT_Y = H - 24;
  const MAX_Y = FOOT_Y - 6;
  const LH = 4.3;         // Zeilenhöhe Positionstext
  const LHK = 3.9;        // Zeilenhöhe Beschreibung / Fließtext
  const istRe = ["rechnung", "teilrechnung", "schlussrechnung"].includes(b.typ);
  const istAngebot = b.typ === "angebot" || b.typ === "auftragsbestaetigung";
  const entwurf = !b.nummer;
  const art = TYP_DATEINAME[b.typ] ?? b.typ;
  const titel = entwurf ? `${art} (Entwurf)` : `${art} ${b.nummer}`;
  const GESAMT = "{gesamt}";
  const firma = f.firma || "Ruff Michael GmbH";

  const normal = (pt: number, farbe = 0) => { doc.setFont("helvetica", "normal"); doc.setFontSize(pt); doc.setTextColor(farbe); };
  const fett = (pt: number, farbe = 0) => { doc.setFont("helvetica", "bold"); doc.setFontSize(pt); doc.setTextColor(farbe); };

  // ── Fußzeile (jede Seite) ────────────────────────────────────────────
  const fuss = () => {
    const seite = doc.getNumberOfPages();
    doc.setDrawColor(170); doc.setLineWidth(0.3); doc.line(M, FOOT_Y, R, FOOT_Y);
    const bank = [f.bank ? `Institut ${f.bank}` : null, f.iban ? `IBAN ${f.iban}` : null, f.bic ? `BIC ${f.bic}` : null].filter(Boolean).join("  •  ");
    fett(8.5); doc.text("Bankverbindung", W / 2, FOOT_Y + 4.2, { align: "center" });
    normal(8); if (bank) doc.text(bank, W / 2, FOOT_Y + 8.2, { align: "center" });
    // § 14 UGB: Firma, Sitz, Firmenbuch, Gericht, UID
    const sitz = f.plz_ort ? String(f.plz_ort).replace(/^\d{4}\s*/, "") : "";
    const recht = [firma, sitz ? `Sitz: ${sitz}` : null, f.firmenbuch ? `FN ${String(f.firmenbuch).replace(/^FN\s*/i, "")}` : null, f.gericht || null, f.uid ? `UID ${f.uid}` : null, f.fusstext || null].filter(Boolean).join("  •  ");
    normal(6.5, 110); doc.text(doc.splitTextToSize(recht, R - M)[0], W / 2, FOOT_Y + 12.2, { align: "center" });
    normal(8, 60); doc.text(`Seite ${seite} von ${GESAMT}`, W / 2, FOOT_Y + 17, { align: "center" });
    doc.setTextColor(0);
  };
  // Kopfzeile auf Folgeseiten
  const folgeKopf = () => {
    fett(10.5); doc.text(`${titel} vom ${datum(b.datum)}`, M, M + 4);
    doc.setDrawColor(170); doc.setLineWidth(0.3); doc.line(M, M + 8, R, M + 8);
    normal(9.5);
    return M + 16;
  };
  const neueSeite = () => { fuss(); doc.addPage(); return folgeKopf(); };
  // Entwurf: Wasserzeichen quer über die Seite
  const wasserzeichen = () => {
    if (!entwurf) return;
    doc.saveGraphicsState?.();
    fett(60, 225);
    doc.text("ENTWURF", W / 2, H / 2 + 20, { align: "center", angle: 40 });
    doc.restoreGraphicsState?.();
    doc.setTextColor(0);
  };

  // ── Seite 1: Briefkopf ────────────────────────────────────────────────
  wasserzeichen();
  let y = 14;
  if (logo) { try { doc.addImage(logo, "PNG", M, y - 2, 46, 30); } catch { /* ohne Logo */ } }
  normal(15); doc.text(firma, W / 2 + 6, y + 10, { align: "center" });
  normal(9, 30);
  const kopfRechts = [f.strasse, f.plz_ort, f.telefon ? `Tel: ${f.telefon}` : null, f.fax ? `Fax: ${f.fax}` : null, f.email, f.web, f.uid ? `UID: ${f.uid}` : null].filter(Boolean) as string[];
  kopfRechts.forEach((t, i) => doc.text(t, R, y + 1 + i * 4.1, { align: "right" }));
  doc.setTextColor(0);
  const kopfEnde = Math.max(y + 30, y + 1 + kopfRechts.length * 4.1);
  doc.setDrawColor(190); doc.setLineWidth(0.3); doc.line(M, kopfEnde + 2, R, kopfEnde + 2);

  // Absender + Empfänger links, Kundeninfo-Kasten rechts
  y = kopfEnde + 9;
  normal(6.5, 90);
  doc.text(`Abs.: ${[firma, f.strasse, f.plz_ort].filter(Boolean).join(" • ")}`, M, y);
  doc.setDrawColor(150); doc.line(M, y + 1, M + 88, y + 1);
  normal(10.5);
  const empf: string[] = [];
  for (const t of [b.kunde_name, b.kunde_zusatz, b.kunde_strasse, b.kunde_plz_ort]) {
    if (t) empf.push(...doc.splitTextToSize(String(t), 88));
  }
  empf.forEach((t, i) => doc.text(t, M, y + 7 + i * 5));
  const empfEnde = y + 7 + empf.length * 5;

  const boxX = M + 104, boxW = R - boxX;
  const info: [string, string][] = [];
  if (kundennr) info.push(["Kunden-Nr.:", kundennr]);
  if (b.kunde_email) info.push(["eMail:", String(b.kunde_email)]);
  if (b.kunde_uid) info.push(["UID-Nr.:", String(b.kunde_uid)]);
  if (projektName) info.push(["Projekt:", projektName]);
  let boxEnde = y;
  if (info.length) {
    const zeilen: [string, string[]][] = info.map(([k, v]) => [k, doc.splitTextToSize(v, boxW - 32)]);
    const hoehe = 9 + zeilen.reduce((s, [, v]) => s + v.length * 4.4, 0) + 3;
    doc.setDrawColor(200); doc.setFillColor(252); doc.setLineWidth(0.3);
    doc.roundedRect(boxX, y - 2, boxW, hoehe, 1.5, 1.5, "FD");
    fett(9.5); doc.text("Kundeninfo", boxX + 4, y + 3.5);
    normal(9);
    let yy = y + 9;
    for (const [k, v] of zeilen) {
      doc.text(k, boxX + 4, yy);
      doc.text(v, boxX + 28, yy);
      yy += v.length * 4.4;
    }
    boxEnde = y - 2 + hoehe;
  }

  // ── Titel + Meta rechts ───────────────────────────────────────────────
  y = Math.max(empfEnde, boxEnde, 92) + 10;
  const meta: string[] = [`Datum: ${datum(b.datum)}`];
  if (f.bearbeiter) meta.push(`Bearbeiter: ${f.bearbeiter}`);
  if (istRe || b.typ === "gutschrift") {
    if (b.leistung_von || b.leistung_bis) {
      meta.push(b.leistung_von && b.leistung_bis && b.leistung_von !== b.leistung_bis
        ? `Leistungszeitraum: ${datum(b.leistung_von)} – ${datum(b.leistung_bis)}`
        : `Leistungsdatum: ${datum(b.leistung_von || b.leistung_bis)}`);
    }
  }
  if (istRe && b.faellig_am) meta.push(`Zahlbar bis: ${datum(b.faellig_am)}`);
  if (b.typ === "angebot" && b.gueltig_bis) meta.push(`Gültig bis: ${datum(b.gueltig_bis)}`);
  if (b.vorgaenger_nummer) meta.push(`${b.typ === "gutschrift" ? "zu Rechnung" : "Angebot"}: ${b.vorgaenger_nummer}`);
  fett(13); doc.text(doc.splitTextToSize(titel, 105), M, y);
  normal(9.5);
  meta.forEach((t, i) => doc.text(t, R, y + i * 4.4, { align: "right" }));
  y += Math.max(6, meta.length * 4.4) + 2;
  if (b.betreff) { fett(10); doc.text(doc.splitTextToSize(String(b.betreff), R - M), M, y); y += 5.5; normal(9.5); }
  y += 2;
  if (b.einleitung) {
    normal(9.5);
    const lines = doc.splitTextToSize(String(b.einleitung), R - M);
    doc.text(lines, M, y); y += lines.length * 4.4 + 4;
  }

  // ── Positionen ────────────────────────────────────────────────────────
  const col = { pos: M + 1.5, text: M + 13, einzel: M + 128, menge: M + 152, summe: R - 1 };
  const textBreite = 82;
  const band = (links: string, rechts?: string) => {
    doc.setFillColor(228); doc.rect(M, y - 4.6, R - M, 6.4, "F");
    fett(9.5, 30); doc.text(links, M + 2, y);
    if (rechts) doc.text(rechts, col.summe, y, { align: "right" });
    normal(9.5); y += 6.5;
  };
  const tabellenKopf = () => {
    doc.setFillColor(228); doc.rect(M, y - 4.6, R - M, 6.4, "F");
    fett(9.5, 30);
    doc.text("Pos", col.pos, y); doc.text("Beschreibung", col.text, y);
    doc.text("Einzelpreis €", col.einzel, y, { align: "right" });
    doc.text("Menge", col.menge, y, { align: "right" });
    doc.text("Summe €", col.summe, y, { align: "right" });
    normal(9.5); y += 7.5;
  };
  let laufsumme = 0;
  // Seitenwechsel innerhalb der Tabelle: Übertrag unten, Übertrag + Kopf oben
  const tabelleUmbruch = () => {
    y = Math.min(y, MAX_Y - 3);
    doc.setFillColor(238); doc.rect(M, y - 4.6, R - M, 6.4, "F");
    normal(9.5, 40); doc.text("Übertrag", col.einzel + 4, y); doc.text(eur(laufsumme), col.summe, y, { align: "right" });
    y = neueSeite(); wasserzeichen();
    band("Übertrag", eur(laufsumme));
    tabellenKopf();
  };
  tabellenKopf();
  let nr = 0;
  for (const p of positionen) {
    const istPos = p.art === "position";
    const textLines: string[] = doc.splitTextToSize(String(p.text || ""), textBreite);
    const beschr: string[] = p.beschreibung ? doc.splitTextToSize(String(p.beschreibung), textBreite) : [];
    const hatRabatt = istPos && Number(p.rabatt_prozent) > 0;
    // Kopfzeile der Position (Text + Zahlen) muss auf die Seite passen — sonst vorher umbrechen
    if (y + textLines.length * LH + 4 > MAX_Y - 8) tabelleUmbruch();
    if (p.art === "ueberschrift") {
      fett(10); doc.text(textLines, col.text, y); normal(9.5);
    } else if (p.art === "text") {
      normal(9, 70); doc.text(textLines, col.text, y); normal(9.5);
    } else {
      nr += 1;
      doc.text(String(nr), col.pos, y);
      fett(9.5); doc.text(textLines, col.text, y); normal(9.5);
      doc.text(betrag(p.einzelpreis), col.einzel, y, { align: "right" });
      doc.text(`${menge2(p.menge)} ${p.einheit ?? ""}`.trim(), col.menge, y, { align: "right" });
      doc.text(betrag(p.gesamt), col.summe, y, { align: "right" });
      laufsumme += Number(p.gesamt ?? 0);
    }
    y += textLines.length * LH;
    // Beschreibung blockweise — auch sehr lange Texte laufen nie in die Fußzeile
    if (beschr.length) {
      normal(8.5, 80);
      let rest = beschr;
      while (rest.length) {
        const frei = Math.floor((MAX_Y - 8 - y) / LHK);
        if (frei < 2) { tabelleUmbruch(); normal(8.5, 80); continue; }
        const teil = rest.slice(0, frei);
        doc.text(teil, col.text, y); y += teil.length * LHK; rest = rest.slice(frei);
      }
      normal(9.5);
    }
    if (hatRabatt) {
      if (y + 3.5 > MAX_Y - 8) tabelleUmbruch();
      normal(7.5, 110); doc.text(`abzgl. ${zahl(p.rabatt_prozent)} % Rabatt`, col.text, y); normal(9.5); y += 3.5;
    }
    y += 2.4;
  }

  // ── Summen ────────────────────────────────────────────────────────────
  if (y + 30 > MAX_Y) { tabelleUmbruch(); }
  y += 2;
  doc.setDrawColor(120); doc.setLineWidth(0.3); doc.line(M, y - 2, R, y - 2);
  y += 5;
  const sumX = M + 110;
  const sumZeile = (k: string, v: string, dick = false) => {
    if (dick) fett(10.5); else normal(9.5);
    doc.text(k, sumX, y); doc.text(v, col.summe, y, { align: "right" }); y += 5.4;
  };
  sumZeile("Netto", betrag(b.netto));
  if (b.reverse_charge) sumZeile("Umsatzsteuer: Übergang der Steuerschuld", "0,00");
  else sumZeile(`${zahl(b.ust_satz)}% MwSt`, betrag(b.ust));
  doc.setDrawColor(0); doc.setLineWidth(0.4); doc.line(sumX, y - 3.6, R, y - 3.6);
  sumZeile(b.typ === "gutschrift" ? "Gutschriftsbetrag €" : "Gesamtbetrag €", betrag(b.brutto), true);
  doc.line(sumX, y - 3.2, R, y - 3.2); doc.line(sumX, y - 2.4, R, y - 2.4);
  doc.setLineWidth(0.2);
  y += 4;

  // ── Fließtext-Helfer (mit Seitenumbruch) ──────────────────────────────
  // Eingerückte Zeilen (z. B. „   - Monteur: …“) werden 5 mm eingerückt gesetzt.
  const EINZUG = "\u0001";
  const absatz = (text: string, pt = 9.5, farbe = 0, dick = false, abstand = 3) => {
    const zeilen: string[] = [];
    if (dick) fett(pt, farbe); else normal(pt, farbe);
    for (const roh of String(text).split("\n")) {
      const eingerueckt = /^\s+\S/.test(roh);
      const t = roh.trim();
      if (!t) { zeilen.push(""); continue; }
      for (const z of doc.splitTextToSize(t, R - M - (eingerueckt ? 5 : 0)) as string[]) zeilen.push((eingerueckt ? EINZUG : "") + z);
    }
    let i = 0;
    while (i < zeilen.length) {
      const frei = Math.floor((MAX_Y - y) / LHK);
      if (frei < 2) { y = neueSeite(); wasserzeichen(); continue; }
      const teil = zeilen.slice(i, i + frei);
      if (dick) fett(pt, farbe); else normal(pt, farbe);
      teil.forEach((z, j) => {
        const eingerueckt = z.startsWith(EINZUG);
        if (z) doc.text(eingerueckt ? z.slice(1) : z, M + (eingerueckt ? 5 : 0), y + j * LHK);
      });
      y += teil.length * LHK; i += teil.length;
    }
    y += abstand; normal(9.5);
  };
  const ueberschrift = (t: string) => { if (y + 10 > MAX_Y) { y = neueSeite(); wasserzeichen(); } fett(10); doc.text(t, M, y); y += 5.5; normal(9.5); };
  const unterschriften = (links: string, rechts: string) => {
    if (y + 22 > MAX_Y) { y = neueSeite(); wasserzeichen(); }
    y += 12;
    doc.setDrawColor(90); doc.setLineWidth(0.3);
    doc.setLineDashPattern([0.7, 1.1], 0);
    doc.line(M, y, M + 60, y); doc.line(R - 75, y, R, y);
    doc.setLineDashPattern([], 0);
    normal(9); doc.text(links, M, y + 4.5); doc.text(rechts, R - 75, y + 4.5); normal(9.5);
    y += 12;
  };

  // ── Hinweise nach den Summen ──────────────────────────────────────────
  if (b.reverse_charge) absatz("Übergang der Steuerschuld gemäß § 19 Abs. 1a UStG (Bauleistung). Die Rechnung enthält keine Umsatzsteuer; Steuerschuldner ist der Leistungsempfänger.");
  if (istRe) {
    const skonto = b.skonto_prozent && b.skonto_tage ? ` — bei Zahlung innerhalb von ${b.skonto_tage} Tagen ${zahl(b.skonto_prozent)} % Skonto` : "";
    absatz(`Zahlbar bis ${datum(b.faellig_am)} ohne Abzug${skonto}. Bitte überweisen Sie den Betrag auf das unten angeführte Konto — Verwendungszweck: ${b.nummer ?? titel}.`);
  }
  if (b.typ === "gutschrift") absatz("Der Betrag wird auf das uns bekannte Konto überwiesen bzw. mit offenen Forderungen verrechnet.");
  if (b.schlusstext) absatz(String(b.schlusstext));

  if (istAngebot) {
    if (b.gueltig_bis) absatz(`Preisgültigkeit: bis ${datum(b.gueltig_bis)}`, 9.5, 0, false, 4);
    if (f.angebot_bedingungen) { ueberschrift("Auftragsbedingungen:"); absatz(String(f.angebot_bedingungen), 9, 0, false, 5); }
    if (f.angebot_zahlung) absatz(String(f.angebot_zahlung), 9.5, 0, false, 2);
    unterschriften("Ort, Datum", "Unterschrift des Auftraggebers");
    if (f.angebot_widerruf_zeigen !== false && f.angebot_widerruf) {
      ueberschrift("Widerrufsbelehrung nach Fern- und Auswärtsgeschäfte-Gesetz (FAGG)");
      absatz(String(f.angebot_widerruf), 9, 0, false, 2);
      unterschriften("Ort, Datum", "Unterschrift Kunde");
    }
  }
  fuss();
  doc.putTotalPages(GESAMT);
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
