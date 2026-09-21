#!/usr/bin/env node
// KingBill → Ruff-App: Kunden, Artikel, Belege (Angebote, Auftragsbestätigungen,
// Rechnungen, Gutschriften) samt Positionen, Zahlungen, Mahnungen und Eingangsrechnungen.
//
// Voraussetzung: die KingBill-Sicherung (main.accdb) wurde mit export.py in JSON-Dateien
// je Tabelle ausgelesen (Ordner --json). Ohne --schreiben läuft nur der Probelauf.
//
//   SUPABASE_SERVICE_KEY=… node scripts/kingbill-import.mjs --json ./json [--schreiben]
//
// Wiederholbar: Kunden werden über die Kundennummer, Belege über (Kreis, Nummer),
// Eingangsrechnungen über Lieferant+Nummer erkannt und nicht doppelt angelegt.
// Vor dem Schreiben müssen die Trigger trg_pos_schreibschutz und trg_positionen_summen
// auf beleg_positionen aus sein (Positionen an erstellte Rechnungen, Summen aus KingBill).

import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const SCHREIBEN = process.argv.includes("--schreiben");
const JSON_DIR = arg("--json", "./json");
const SUPA = process.env.SUPABASE_URL || "https://xaugcspfgtuozlijdfqu.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error("SUPABASE_SERVICE_KEY fehlt"); process.exit(1); }

const L = (n) => JSON.parse(readFileSync(`${JSON_DIR}/${n}.json`, "utf8"));
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
async function rest(pfad, init = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${pfad}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${pfad.slice(0, 60)} → ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
async function alle(pfad) {
  const out = [];
  for (let von = 0; ; von += 1000) {
    const s = await rest(`${pfad}${pfad.includes("?") ? "&" : "?"}limit=1000&offset=${von}`);
    out.push(...s); if (s.length < 1000) break;
  }
  return out;
}
async function einfuegen(tabelle, zeilen, groesse = 500) {
  for (let i = 0; i < zeilen.length; i += groesse) {
    await rest(tabelle, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(zeilen.slice(i, i + groesse)) });
    process.stdout.write(`\r  ${tabelle}: ${Math.min(i + groesse, zeilen.length)}/${zeilen.length}   `);
  }
  if (zeilen.length) console.log();
}

// ── Hilfen ────────────────────────────────────────────────────────────────
const s = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const zahl = (v) => { if (v === null || v === undefined || v === "") return 0; const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
// Beträge aus dem Access-Leser: Dezimalwerte kommen als „36.000000“; bei Werten unter 1 fehlt
// das führende „0.“ („500000“ = 0,5). Ganzzahlige Strings ohne Punkt sind daher Mikro-Werte.
const betrag = (v) => { if (typeof v === "string" && /^-?\d+$/.test(v.trim()) && v.trim() !== "0") return Number(v) / 1e6; return zahl(v); };
// Nur echte Kalendertage — KingBill enthält Tippfehler wie „30.2.2022“
const gueltig = (j, m, t) => { const d = new Date(Date.UTC(j, m - 1, t)); return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t; };
const datum = (v) => { const m = s(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m && gueltig(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const leer = (v) => (s(v) === "" ? null : s(v));
// Access-Dezimal (im JSON als {__dez__: hex}) → Zahl, Skala 6
function dez(v) {
  if (v && typeof v === "object" && v.__dez__) {
    const b = Buffer.from(v.__dez__, "hex"); const neg = b[0] & 0x80;
    const w = [0, 4, 8, 12].map((o) => b.readUInt32LE(1 + o));
    const n = (BigInt(w[0]) << 96n) | (BigInt(w[1]) << 64n) | (BigInt(w[2]) << 32n) | BigInt(w[3]);
    const f = Number(n) / 1e6; return neg ? -f : f;
  }
  return betrag(v);
}
// RTF → Text (KingBill speichert Betreff, Vor-/Schlusstexte und Beschreibungen als RTF)
function rtf(v) {
  const t = s(v);
  if (!t.startsWith("{\\rtf")) return t;
  let out = "", i = 0, tiefe = 0, ueberspringen = 0; // ueberspringen: Tiefe einer Zielgruppe (fonttbl …)
  const cp1252 = { 0x80: "€", 0x82: "‚", 0x84: "„", 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—" };
  while (i < t.length) {
    const c = t[i];
    if (c === "{") { tiefe++; const rest = t.slice(i + 1, i + 14); if (/^\\\*|^\\(fonttbl|colortbl|stylesheet|info|listtable|generator)/.test(rest) && !ueberspringen) ueberspringen = tiefe; i++; continue; }
    if (c === "}") { if (ueberspringen === tiefe) ueberspringen = 0; tiefe--; i++; continue; }
    if (c === "\\") {
      const m = t.slice(i).match(/^\\([a-z]+)(-?\d+)? ?/i);
      if (m) {
        const w = m[1], n = m[2];
        if (!ueberspringen) {
          if (w === "par" || w === "line") out += "\n";
          else if (w === "tab") out += "\t";
          else if (w === "u" && n) { out += String.fromCharCode(((Number(n) % 65536) + 65536) % 65536); const nach = t[i + m[0].length]; if (nach === "?") i++; }
        }
        i += m[0].length; continue;
      }
      const h = t.slice(i).match(/^\\'([0-9a-f]{2})/i);
      if (h) { if (!ueberspringen) { const code = parseInt(h[1], 16); out += cp1252[code] ?? (code >= 0xa0 ? Buffer.from([code]).toString("latin1") : ""); } i += 4; continue; }
      if (!ueberspringen && (t[i + 1] === "\\" || t[i + 1] === "{" || t[i + 1] === "}")) { out += t[i + 1]; i += 2; continue; }
      i += 2; continue;
    }
    if (c === "\r" || c === "\n") { i++; continue; }
    if (!ueberspringen) out += c;
    i++;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
const EINHEIT = { "stk.": "Stk", "stk": "Stk", "std.": "Std", "std": "Std", "pauschale": "psch", "psch": "psch", "lfm": "lfm", "m": "m", "m²": "m²", "m2": "m²", "m³": "m³", "liter": "Liter", "l": "Liter", "kg": "kg", "tage": "Tage", "km": "km", "set": "Set", "": "Stk" };
const einheit = (v) => EINHEIT[s(v).toLowerCase()] ?? (s(v).replace(/\.$/, "") || "Stk");
const nummerAus = (betreff) => { const m = s(betreff).match(/(\d{4})-(\d{4})/); return m ? { nummer: `${m[1]}-${m[2]}`, jahr: Number(m[1]), lauf: Number(m[2]) } : null; };
function leistung(v) {
  const d = [...s(v).matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)].filter((m) => gueltig(+m[3], +m[2], +m[1])).map((m) => `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  return { von: d[0] ?? null, bis: d[1] ?? d[0] ?? null };
}
const name = (vn, nn, firma) => [s(vn), s(nn)].filter(Boolean).join(" ") || s(firma);

// ── Daten laden ───────────────────────────────────────────────────────────
const KB = {
  kunden: L("Customer"), artikel: L("Product"), rechnungen: L("DokumentRechnung"), rPos: L("DokumentRechnungPosition"),
  angebote: L("DokumentAngebot"), aPos: L("DokumentAngebotPosition"), auftraege: L("DokumentAuftrag"), auPos: L("DokumentAuftragPosition"),
  gutschriften: L("DokumentGutschrift"), gPos: L("DokumentGutschriftPosition"), texte: L("DokumentText"), zahlungen: L("Payment"),
  er: L("Eingangsrechnung"), erZahl: L("EingangsrechnungZahlung"), erSkonto: L("EingangsrechnungSkonto"), erArt: L("EingangsrechnungRechnungsart"),
  mahnungen: L("PayReminderLog"), log: L("ActionLog"),
};
console.log(`KingBill: ${KB.kunden.length} Kunden, ${KB.rechnungen.length} Rechnungen, ${KB.angebote.length} Angebote, ${KB.auftraege.length} Aufträge, ${KB.gutschriften.length} Gutschriften, ${KB.zahlungen.length} Zahlungen, ${KB.er.length} Eingangsrechnungen, ${KB.artikel.length} Artikel`);
console.log(SCHREIBEN ? "\n>>> SCHREIBMODUS <<<\n" : "\n(Probelauf — es wird nichts geschrieben)\n");

const app = {
  kunden: await alle("customers?select=id,kundennr,vorname,nachname,firma,email,telefon,mobil,strasse,ort,uid"),
  materials: await alle("materials?select=id,artikelnummer,name"),
  belege: await alle("belege?select=id,kreis,nummer"),
  er: await alle("eingangsrechnungen?select=id,nummer,lieferant,notiz"),
};
console.log(`App: ${app.kunden.length} Kunden, ${app.materials.length} Artikel, ${app.belege.length} Belege, ${app.er.length} Eingangsrechnungen`);
// Fortsetzbar: schon übernommene KingBill-Belege an ihrer Kennung erkennen (Notiz „Aus KingBill übernommen (R123, …)“)
const belegeKB = new Map();
for (const b of await alle("belege?select=id,notizen&notizen=like.Aus%20KingBill*")) { const m = s(b.notizen).match(/\((\w\d+),/); if (m) belegeKB.set(m[1], b.id); }
const mitPos = new Set(belegeKB.size ? (await alle("beleg_positionen?select=beleg_id")).map((x) => x.beleg_id) : []);
const mitZahlung = new Set(belegeKB.size ? (await alle("beleg_zahlungen?select=beleg_id")).map((x) => x.beleg_id) : []);
if (belegeKB.size) console.log(`Fortsetzung: ${belegeKB.size} KingBill-Belege vorhanden, ${mitPos.size} davon mit Positionen`);
const protokoll = { kunden_neu: [], kunden_aktualisiert: 0, artikel_neu: [], artikel_aktualisiert: 0, belege: [], positionen: 0, zahlungen: 0, er_neu: [], uebersprungen: {} };
const skip = (grund) => { protokoll.uebersprungen[grund] = (protokoll.uebersprungen[grund] ?? 0) + 1; };

// ── 1. Kunden ─────────────────────────────────────────────────────────────
const kundeNachNr = new Map(app.kunden.filter((k) => k.kundennr).map((k) => [k.kundennr, k]));
const kundeNachName = new Map(app.kunden.filter((k) => !k.kundennr).map((k) => [name(k.vorname, k.nachname, k.firma).toLowerCase(), k]));
const kundeMap = new Map(); // KingBill Customer.ID → app uuid
const kundenNeu = [], kundenUpdate = [];
const nrVergeben = new Set(app.kunden.map((k) => k.kundennr).filter(Boolean));
for (const c of KB.kunden) {
  let nr = s(c.Nummer);
  // KingBill selbst hat doppelte Kundennummern (z. B. 1642 zweimal) — die zweite bekommt ein „b“
  if (nr && nrVergeben.has(nr) && !kundeNachNr.get(nr)) nr = `${nr}b`;
  const vorhandenNr = kundeNachNr.get(nr);
  if (nr && !vorhandenNr && nrVergeben.has(nr)) nr = `${nr}b`;
  if (nr && !vorhandenNr) nrVergeben.add(nr);
  let vn = leer(c.Vorname), nn = leer(c.Nachname), firma = leer(c.Firma);
  if (!nn && !firma) { if (vn) { nn = vn; vn = null; } else { skip("Kunde ohne Namen"); continue; } }
  const strasse = [s(c["Straße"]), s(c.Hausnummer)].filter(Boolean).join(" ");
  const zeile = {
    kundennr: nr || null, vorname: vn ?? "", nachname: nn ?? firma, firma,
    strasse: leer(strasse), ort: leer([s(c.PLZ), s(c.Ort)].filter(Boolean).join(" ")),
    telefon: leer(c.TelefonFirma) ?? leer(c.TelefonPrivat), mobil: leer(c.TelefonMobil), email: leer(c.Email),
    uid: leer(c.UID), ist_unternehmer: !!(firma || leer(c.UID)), reverse_charge: false,
    zahlungsziel_tage: zahl(c.Zahlungsziel) > 0 ? zahl(c.Zahlungsziel) : null,
    liefer_strasse: leer(c.LieferAdresse), liefer_ort: null,
  };
  const vorhanden = kundeNachNr.get(nr) ?? kundeNachName.get(name(vn, nn, firma).toLowerCase());
  if (vorhanden) {
    kundeMap.set(String(c.ID), vorhanden.id);
    // KingBill ist die Stammquelle — leere App-Felder füllen, Kundennummer nachtragen
    const patch = {};
    for (const [k, v] of Object.entries(zeile)) if (v !== null && v !== "" && v !== false && (vorhanden[k] === null || vorhanden[k] === undefined || vorhanden[k] === "")) patch[k] = v;
    if (Object.keys(patch).length) kundenUpdate.push({ id: vorhanden.id, patch });
    if (!vorhanden.kundennr && nr) kundeNachName.delete(name(vn, nn, firma).toLowerCase());
  } else {
    const id = randomUUID(); kundeMap.set(String(c.ID), id);
    kundenNeu.push({ id, ...zeile, created_at: s(c.DatumErstellt) || undefined });
  }
}
protokoll.kunden_neu = kundenNeu.map((k) => k.id); protokoll.kunden_aktualisiert = kundenUpdate.length;
console.log(`Kunden: ${kundenNeu.length} neu, ${kundenUpdate.length} vorhandene ergänzt, ${kundeMap.size} zugeordnet`);

// ── 2. Artikel ────────────────────────────────────────────────────────────
const matNachNr = new Map(app.materials.filter((m) => m.artikelnummer).map((m) => [m.artikelnummer, m]));
const matNachName = new Map(app.materials.map((m) => [s(m.name).toLowerCase(), m]));
const artikelNeu = [], preiseNeu = [], preiseUpdate = [];
for (const p of KB.artikel) {
  const n = leer(p.Name); if (!n) { skip("Artikel ohne Namen"); continue; }
  const vk = betrag(p.SalesPrice), ek = betrag(p.PurchasePrice);
  const vorhanden = matNachNr.get(s(p.CodeNr)) ?? matNachName.get(n.toLowerCase());
  if (vorhanden) { if (vk > 0) preiseUpdate.push({ material_id: vorhanden.id, einkaufspreis: ek > 0 ? ek : null, verkaufspreis: vk }); continue; }
  const id = randomUUID();
  artikelNeu.push({ id, name: n.slice(0, 200), artikelnummer: leer(p.CodeNr), einheit: leer(p.Unit) ? einheit(p.Unit) : null, kategorie: leer(p.Category) ?? "Material", quelle: "import-kingbill", is_active: true });
  preiseNeu.push({ material_id: id, einkaufspreis: ek > 0 ? ek : null, verkaufspreis: vk > 0 ? vk : null });
}
protokoll.artikel_neu = artikelNeu.map((a) => a.id); protokoll.artikel_aktualisiert = preiseUpdate.length;
console.log(`Artikel: ${artikelNeu.length} neu, ${preiseUpdate.length} Preise aktualisiert`);

// ── 3. Belege ─────────────────────────────────────────────────────────────
const texte = new Map();
for (const t of KB.texte) for (const [k, art] of [["ID_DokumentRechnung", "R"], ["ID_DokumentAngebot", "A"], ["ID_DokumentAuftrag", "U"], ["ID_DokumentGutschrift", "G"]]) if (zahl(t[k]) > 0) texte.set(`${art}${t[k]}`, t);
const posNach = (liste, fk) => { const m = new Map(); for (const p of liste) { const k = String(p[fk]); (m.get(k) ?? m.set(k, []).get(k)).push(p); } return m; };
const POS = { R: posNach(KB.rPos, "ID_DokumentRechnung"), A: posNach(KB.aPos, "ID_DokumentAngebot"), U: posNach(KB.auPos, "ID_DokumentAuftrag"), G: posNach(KB.gPos, "ID_DokumentGutschrift") };
// Verkettung aus dem ActionLog: Quelle → Ziel
const vorgaenger = new Map(); // "R123" → "U456"
const nachfolgerVon = new Map(); // "A12" → Set("U34")
for (const e of KB.log) {
  const q = ["Angebot", "Auftrag", "Rechnung", "Gutschrift"].map((a) => [a, e[`Source_ID_Dokument${a}`]]).find(([, v]) => zahl(v) > 0);
  const z = ["Angebot", "Auftrag", "Rechnung", "Gutschrift"].map((a) => [a, e[`Target_ID_Dokument${a}`]]).find(([, v]) => zahl(v) > 0);
  if (!q || !z || q[0] === z[0]) continue;
  const code = { Angebot: "A", Auftrag: "U", Rechnung: "R", Gutschrift: "G" };
  const qs = `${code[q[0]]}${q[1]}`, zs = `${code[z[0]]}${z[1]}`;
  if (!vorgaenger.has(zs)) vorgaenger.set(zs, qs);
  (nachfolgerVon.get(qs) ?? nachfolgerVon.set(qs, new Set()).get(qs)).add(zs);
}
const mahnungenVon = new Map();
for (const m of KB.mahnungen) { const k = String(m.ID_DokumentRechnung); (mahnungenVon.get(k) ?? mahnungenVon.set(k, []).get(k)).push(m); }
const zahlungenVon = new Map();
for (const z of KB.zahlungen) { const k = String(z.ID_DokumentRechnung); (zahlungenVon.get(k) ?? zahlungenVon.set(k, []).get(k)).push(z); }

const vorhandeneNummern = new Set(app.belege.filter((b) => b.nummer).map((b) => `${b.kreis}|${b.nummer}`));
const uuidVon = new Map(); // "R123" → uuid
const belegeNeu = [], positionenNeu = [], zahlungenNeu = [], stornoNach = [];
const vergebene = new Set();
const QUELLEN = [["A", KB.angebote, "angebot", "angebot"], ["U", KB.auftraege, "auftragsbestaetigung", "auftragsbestaetigung"], ["R", KB.rechnungen, "rechnung", "rechnung"], ["G", KB.gutschriften, "gutschrift", "gutschrift"]];
for (const [code, docs, typ, kreis] of QUELLEN) {
  for (const d of docs) {
    const kb = `${code}${d.ID}`;
    const nr = nummerAus(d.Betreff);
    let nummer = nr?.nummer ?? null;
    if (nummer && vergebene.has(`${kreis}|${nummer}`)) nummer = `${nummer}b`;
    if (nummer) vergebene.add(`${kreis}|${nummer}`);
    const kbVorh = belegeKB.get(kb) ?? null;
    if (!kbVorh && nummer && vorhandeneNummern.has(`${kreis}|${nummer}`)) { skip(`${typ} schon vorhanden (nicht aus KingBill)`); continue; }
    const id = kbVorh ?? randomUUID(); uuidVon.set(kb, id);
    const posNachziehen = !kbVorh || !mitPos.has(id);
    const zahlNachziehen = !kbVorh || !mitZahlung.has(id);
    const positionen = (POS[code].get(String(d.ID)) ?? []).slice().sort((a, b) => zahl(a.PosIndex) - zahl(b.PosIndex));
    const gs = typ === "gutschrift" ? -1 : 1; // Gutschriften positiv ablegen (die App rechnet mit dem Vorzeichen der Belegart)
    const vz = (v) => (gs < 0 ? Math.abs(v) : v);
    const saetze = positionen.map((p) => betrag(p.MwStProzent)).filter((x) => x >= 0 && x <= 30);
    const ustSatz = saetze.length ? [...saetze].sort((a, b) => saetze.filter((x) => x === b).length - saetze.filter((x) => x === a).length)[0] : 20;
    const netto = r2(vz(betrag(d.SummeNetto))), brutto = r2(vz(betrag(d.SummeBrutto)));
    const t = texte.get(kb);
    const kundeId = kundeMap.get(String(d.ID_Customer)) ?? null;
    const lz = leistung(d.Leistungszeitraum);
    const datumB = datum(d.Datum) ?? "2017-01-01";
    // Status
    let status = nummer ? "festgeschrieben" : "entwurf";
    const nachfolger = nachfolgerVon.get(kb) ?? new Set();
    if (nummer && (typ === "angebot" || typ === "auftragsbestaetigung")) {
      if ([...nachfolger].some((n) => n.startsWith("U") || n.startsWith("R"))) status = "angenommen";
      else if (typ === "angebot" && zahl(d.Status) === 3) status = "abgelehnt";
    }
    // Mahnungen als Notiz
    const mahn = (typ === "rechnung" ? mahnungenVon.get(String(d.ID)) ?? [] : []).map((m) => `Mahnung ${datum(m.Datum) ?? ""}${s(m.Bezeichnung) ? " – " + s(m.Bezeichnung) : ""}`.trim());
    const notizen = [`Aus KingBill übernommen (${kb}, ${datumB})`, ...mahn].join("\n");
    const vg = vorgaenger.get(kb);
    if (!kbVorh) belegeNeu.push({
      id, typ, status, nummer, jahr: nr?.jahr ?? Number(datumB.slice(0, 4)), laufnummer: nr?.lauf ?? null,
      customer_id: kundeId, vorgaenger_id: vg ? (uuidVon.get(vg) ?? null) : null,
      kunde_name: leer(d.KundeName) ?? "Unbekannt", kunde_zusatz: leer(d.KontaktPerson), kunde_strasse: leer(d.KundeAdresse),
      kunde_plz_ort: leer([s(d.KundePLZ), s(d.KundeOrt)].filter(Boolean).join(" ")), kunde_uid: leer(d.UID), kunde_email: leer(d.KundeEmail),
      datum: datumB, leistung_von: lz.von, leistung_bis: lz.bis,
      faellig_am: typ === "angebot" || typ === "auftragsbestaetigung" ? null : datum(d.FaelligkeitsDatum),
      gueltig_bis: typ === "angebot" ? datum(d.FaelligkeitsDatum) : null,
      betreff: leer(rtf(d.ExtraText))?.split("\n")[0]?.slice(0, 200) ?? null,
      einleitung: t ? leer(rtf(t.Vortext)) : null, schlusstext: t ? leer(rtf(t.Schlusstext)) : null,
      reverse_charge: false, ust_satz: ustSatz, netto, ust: r2(brutto - netto), brutto, bezahlt: 0,
      festgeschrieben_am: nummer ? `${datumB}T12:00:00+02:00` : null, notizen, created_at: `${datumB}T12:00:00+02:00`,
    });
    // Positionen (Überschrift bei Gruppenwechsel, Alternativpositionen als Textzeile)
    let pos = 0, gruppe = "";
    for (const p of posNachziehen ? positionen : []) {
      const g = s(p.HauptGruppe);
      if (g && g !== gruppe) { gruppe = g; positionenNeu.push({ beleg_id: id, pos: ++pos, art: "ueberschrift", text: g.slice(0, 300), beschreibung: null, menge: 0, einheit: "Stk", einzelpreis: 0, rabatt_prozent: 0, quelle_typ: "manuell", quelle_ids: [] }); }
      let menge = betrag(p.Menge), preis = vz(betrag(p.EinzelpreisNetto));
      const rabatt = Math.min(100, Math.max(0, betrag(p.RabattProzent)));
      // Ausreißer aus KingBill (kaputte Zeilen mit Milliardenbeträgen) auf 0 setzen, Original in die Beschreibung
      let ausreisser = null;
      if (!Number.isFinite(menge) || Math.abs(menge) > 1e6 || !Number.isFinite(preis) || Math.abs(preis) > 1e7 || Math.abs(menge * preis) > 1e8) { ausreisser = `Unplausibler Wert in KingBill (Menge ${menge}, Preis ${preis}) — auf 0 gesetzt`; menge = 0; preis = 0; skip("Position mit unplausiblem Betrag"); }
      const text = leer(p.Artikelname) ?? leer(p.Artikelnummer) ?? "Position";
      const beschreibung = leer(rtf(p.Beschreibung));
      const alt = p.IsAlternativposition === true || p.IsAlternativposition === "True";
      if (alt) { positionenNeu.push({ beleg_id: id, pos: ++pos, art: "text", text: `Alternativ: ${text} — ${menge} ${einheit(p.Einheit)} × ${preis.toFixed(2)} €`.slice(0, 300), beschreibung, menge: 0, einheit: "Stk", einzelpreis: 0, rabatt_prozent: 0, quelle_typ: "manuell", quelle_ids: [] }); continue; }
      positionenNeu.push({ beleg_id: id, pos: ++pos, art: "position", text: text.slice(0, 300), beschreibung: [leer(p.Artikelnummer) ? `Art.-Nr.: ${s(p.Artikelnummer)}` : null, beschreibung, ausreisser].filter(Boolean).join("\n") || null, menge, einheit: einheit(p.Einheit), einzelpreis: preis, rabatt_prozent: rabatt, quelle_typ: "manuell", quelle_ids: [] });
    }
    // Zahlungen (nur Rechnungen)
    if (typ === "rechnung" && nummer && zahlNachziehen) {
      for (const z of zahlungenVon.get(String(d.ID)) ?? []) {
        const betrag = r2(dez(z.Betrag)), skonto = r2(dez(z.Skonto));
        const art = /bar|kassa/i.test(s(z.Bemerkungen)) ? "bar" : "ueberweisung";
        if (betrag) zahlungenNeu.push({ beleg_id: id, betrag, datum: datum(z.Datum) ?? datum(z.Buchungsdatum) ?? datumB, art, notiz: leer(z.Bemerkungen) });
        if (skonto) zahlungenNeu.push({ beleg_id: id, betrag: skonto, datum: datum(z.Datum) ?? datumB, art: "skonto", notiz: "Skonto (KingBill)" });
      }
    }
    // Gutschrift storniert ihre Rechnung, wenn sie den vollen Betrag deckt
    if (typ === "gutschrift" && vg && vg.startsWith("R")) {
      const re = KB.rechnungen.find((x) => String(x.ID) === vg.slice(1));
      if (re && Math.abs(brutto) >= r2(betrag(re.SummeBrutto)) - 0.05 && uuidVon.get(vg)) stornoNach.push({ rechnung: uuidVon.get(vg), gutschrift: id });
    }
  }
}
protokoll.belege = belegeNeu.map((b) => b.id); protokoll.positionen = positionenNeu.length; protokoll.zahlungen = zahlungenNeu.length;
const proTyp = belegeNeu.reduce((m, b) => (m[b.typ] = (m[b.typ] ?? 0) + 1, m), {});
console.log(`Belege neu: ${belegeNeu.length} (${Object.entries(proTyp).map(([k, v]) => `${k} ${v}`).join(", ")}), ${positionenNeu.length} Positionen, ${zahlungenNeu.length} Zahlungen, ${stornoNach.length} Stornos, ${belegeNeu.filter((b) => b.vorgaenger_id).length} verkettet, ${belegeNeu.filter((b) => !b.customer_id).length} ohne Kunde`);
// Nächste Nummern aus ALLEN Belegen (KingBill + schon in der App), nicht nur aus den neu angelegten
const laufAlle = { angebot: 0, auftragsbestaetigung: 0, rechnung: 0, gutschrift: 0 };
for (const b of belegeNeu) if (b.laufnummer) { const k = b.typ === "teilrechnung" || b.typ === "schlussrechnung" ? "rechnung" : b.typ; laufAlle[k] = Math.max(laufAlle[k], b.laufnummer); }
for (const b of await alle("belege?select=kreis,laufnummer&laufnummer=not.is.null")) laufAlle[b.kreis] = Math.max(laufAlle[b.kreis] ?? 0, b.laufnummer);
const kreise = Object.fromEntries(Object.entries(laufAlle).map(([k, v]) => [k, v + 1]));
console.log("Nächste Nummern:", kreise);

// ── 4. Eingangsrechnungen ─────────────────────────────────────────────────
const erVorhanden = new Set(app.er.filter((e) => s(e.nummer)).map((e) => `${s(e.nummer).toLowerCase()}|${s(e.lieferant).toLowerCase().slice(0, 4)}`));
// Schon übernommene KingBill-Eingangsrechnungen an ihrer Buchungsnummer erkennen (auch ohne Rechnungsnummer)
const erBuchungen = new Set(app.er.map((e) => s(e.notiz).match(/KingBill-Buchung (\d+)/)?.[1]).filter(Boolean));
const erZahlVon = new Map(); for (const z of KB.erZahl) { const k = String(z.ID_Eingangsrechnung); (erZahlVon.get(k) ?? erZahlVon.set(k, []).get(k)).push(z); }
const erSkontoVon = new Map(); for (const z of KB.erSkonto) erSkontoVon.set(String(z.ID_Eingangsrechnung), z);
const erArt = new Map(KB.erArt.map((a) => [String(a.ID), s(a.Name)]));
const erNeu = [];
for (const e of KB.er) {
  const lieferant = leer(e.Rechnungssteller) ?? "Unbekannt", nummer = leer(e.Rechnungsnummer);
  if (erBuchungen.has(s(e.Buchungsnummer))) { skip("Eingangsrechnung schon übernommen"); continue; }
  if (nummer && erVorhanden.has(`${nummer.toLowerCase()}|${lieferant.toLowerCase().slice(0, 4)}`)) { skip("Eingangsrechnung schon vorhanden"); continue; }
  const brutto = r2(dez(e.BetragBrutto)), netto = r2(dez(e.BetragNetto));
  const zahlungen = erZahlVon.get(String(e.ID)) ?? [];
  const bezahltAm = zahlungen.map((z) => datum(z.Datum)).filter(Boolean).sort().pop() ?? null;
  const sk = erSkontoVon.get(String(e.ID));
  erNeu.push({
    lieferant: lieferant.slice(0, 200), nummer, datum: datum(e.DatumRechnung), faellig_am: datum(e.DatumFaelligkeit),
    netto, ust: r2(brutto - netto), brutto, verwendungszweck: leer(e.Verwendungszweck), iban: leer(e.Konto),
    skonto_prozent: sk ? zahl(sk.Prozentsatz) || null : null, skonto_bis: sk ? datum(sk.Datum) : null,
    status: e.Bezahlt === true || e.Bezahlt === "True" ? "bezahlt" : "offen", bezahlt_am: e.Bezahlt === true || e.Bezahlt === "True" ? bezahltAm ?? datum(e.DatumRechnung) : null,
    quelle: "kingbill", erkannt_von: "manuell",
    notiz: [erArt.get(String(e.ID_EingangsrechnungRechnungsart)) ? `Art: ${erArt.get(String(e.ID_EingangsrechnungRechnungsart))}` : null, leer(e.Kommentar), `KingBill-Buchung ${s(e.Buchungsnummer)}`].filter(Boolean).join("\n"),
    created_at: datum(e.DatumPosteingang) ? `${datum(e.DatumPosteingang)}T12:00:00+02:00` : undefined,
  });
}
console.log(`Eingangsrechnungen: ${erNeu.length} neu (${erNeu.filter((e) => e.status === "bezahlt").length} bezahlt)`);
console.log("Übersprungen:", protokoll.uebersprungen);

if (!SCHREIBEN) { writeFileSync(`${JSON_DIR}/_probelauf.json`, JSON.stringify({ kunden: kundenNeu.slice(0, 3), belege: belegeNeu.slice(0, 2), positionen: positionenNeu.slice(0, 5), er: erNeu.slice(0, 2), kreise }, null, 1)); console.log("\nProbelauf fertig — Stichproben in _probelauf.json"); process.exit(0); }

// ── Schreiben ─────────────────────────────────────────────────────────────
console.log("\nSchreibe …");
await einfuegen("customers", kundenNeu);
for (const u of kundenUpdate) await rest(`customers?id=eq.${u.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(u.patch) });
console.log(`  customers: ${kundenUpdate.length} ergänzt`);
await einfuegen("materials", artikelNeu);
await einfuegen("material_prices", preiseNeu);
for (const p of preiseUpdate) await rest(`material_prices?material_id=eq.${p.material_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ einkaufspreis: p.einkaufspreis, verkaufspreis: p.verkaufspreis }) });
console.log(`  material_prices: ${preiseUpdate.length} aktualisiert`);
await einfuegen("belege", belegeNeu, 300);
await einfuegen("beleg_positionen", positionenNeu, 800);
await einfuegen("beleg_zahlungen", zahlungenNeu, 300);
for (const st of stornoNach) await rest(`belege?id=eq.${st.rechnung}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "storniert", storniert_durch: st.gutschrift }) });
console.log(`  belege: ${stornoNach.length} storniert`);
await einfuegen("eingangsrechnungen", erNeu, 300);
for (const [kreis, n] of Object.entries(kreise)) await rest(`faktura_nummernkreise?kreis=eq.${kreis}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ naechste_nummer: n }) });
console.log("  Nummernkreise gesetzt:", kreise);
writeFileSync(`${JSON_DIR}/_import-protokoll.json`, JSON.stringify(protokoll));
console.log("\nFertig. Protokoll: _import-protokoll.json");
