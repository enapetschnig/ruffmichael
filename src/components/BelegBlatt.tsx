import { useLayoutEffect, useRef, useState } from "react";
import { TYP_DATEINAME, datum, type Beleg, type BelegPosition, type Firmendaten } from "@/lib/faktura";

/**
 * Das Belegblatt als HTML — Spiegel des PDF-Layouts (beleg-pdf), gerendert aus
 * dem lokalen Zustand des Editors. Damit ist die Vorschau bei jeder Eingabe
 * sofort aktuell (kein Umweg über den Server). Das endgültige PDF erzeugt die
 * Edge Function mit demselben Aufbau.
 *
 * Maße wie im PDF: A4 (210 mm), Rand 18 mm, Schriftgrößen in pt.
 */

const fmt2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtZahl = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
const betrag = (n: number | string | null | undefined) => fmt2.format(Number(n ?? 0));
const menge2 = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? fmt2.format(v) : new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(v);
};
const rund = (n: number) => Math.round(n * 100) / 100;

type BlattPosition = Pick<BelegPosition, "id" | "art" | "text" | "beschreibung" | "einheit"> & {
  menge: number | string; einzelpreis: number | string; rabatt_prozent: number | string | null;
};

export interface BelegBlattProps {
  beleg: Beleg;
  positionen: BlattPosition[];
  firma: Firmendaten | null;
  kundennr?: string | null;
  projektName?: string | null;
  vorgaengerNr?: string | null;
}

/** Absatz mit Zeilenumbrüchen; eingerückte Zeilen („   - …“) werden eingerückt gesetzt. */
function Absatz({ text, pt = 9.5, className = "" }: { text: string; pt?: number; className?: string }) {
  return (
    <div className={className} style={{ fontSize: `${pt}pt`, lineHeight: 1.32 }}>
      {text.split("\n").map((z, i) => {
        const eingerueckt = /^\s+\S/.test(z);
        const t = z.trim();
        if (!t) return <div key={i} style={{ height: "0.9em" }} />;
        return <div key={i} style={{ paddingLeft: eingerueckt ? "5mm" : 0 }}>{t}</div>;
      })}
    </div>
  );
}

function Unterschriften({ links, rechts }: { links: string; rechts: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12mm", marginBottom: "6mm", fontSize: "9pt" }}>
      <div style={{ width: "60mm", borderTop: "0.3mm dashed #555", paddingTop: "1.5mm" }}>{links}</div>
      <div style={{ width: "75mm", borderTop: "0.3mm dashed #555", paddingTop: "1.5mm" }}>{rechts}</div>
    </div>
  );
}

export function BelegBlatt({ beleg: b, positionen, firma: f, kundennr, projektName, vorgaengerNr }: BelegBlattProps) {
  // Blatt in 210 mm Breite rendern und auf die Kastenbreite skalieren
  const aussen = useRef<HTMLDivElement>(null);
  const blatt = useRef<HTMLDivElement>(null);
  const [mass, setMass] = useState({ k: 1, h: 0 });
  useLayoutEffect(() => {
    const a = aussen.current, s = blatt.current;
    if (!a || !s) return;
    const messen = () => {
      const k = Math.min(1, a.clientWidth / s.offsetWidth);
      setMass({ k, h: s.offsetHeight * k });
    };
    messen();
    const ro = new ResizeObserver(messen);
    ro.observe(a); ro.observe(s);
    return () => ro.disconnect();
  }, []);

  const istRe = ["rechnung", "teilrechnung", "schlussrechnung"].includes(b.typ);
  const istAngebot = b.typ === "angebot" || b.typ === "auftragsbestaetigung";
  const entwurf = !b.nummer;
  const art = TYP_DATEINAME[b.typ] ?? b.typ;
  const titel = entwurf ? `${art} (Entwurf)` : `${art} ${b.nummer}`;
  const firmaName = f?.firma || "Ruff Michael GmbH";

  // Summen lokal — sofort richtig, auch bevor die Datenbank nachgerechnet hat
  const zeilen = positionen.map((p) => {
    const m = Number(p.menge ?? 0), e = Number(p.einzelpreis ?? 0), r = Number(p.rabatt_prozent ?? 0);
    return { ...p, gesamt: p.art === "position" ? rund(m * e * (1 - r / 100)) : 0 };
  });
  const netto = rund(zeilen.reduce((s, p) => s + p.gesamt, 0));
  const ust = b.reverse_charge ? 0 : rund(netto * Number(b.ust_satz ?? 0) / 100);
  const brutto = rund(netto + ust);

  const kopfRechts = [f?.strasse, f?.plz_ort, f?.telefon ? `Tel: ${f.telefon}` : null, f?.fax ? `Fax: ${f.fax}` : null, f?.email, f?.web, f?.uid ? `UID: ${f.uid}` : null].filter(Boolean) as string[];
  const empf = [b.kunde_name, b.kunde_zusatz, b.kunde_strasse, b.kunde_plz_ort].filter(Boolean) as string[];
  const info: [string, string][] = [];
  if (kundennr) info.push(["Kunden-Nr.:", kundennr]);
  if (b.kunde_email) info.push(["eMail:", b.kunde_email]);
  if (b.kunde_uid) info.push(["UID-Nr.:", b.kunde_uid]);
  if (projektName) info.push(["Projekt:", projektName]);
  const meta: string[] = [`Datum: ${datum(b.datum)}`];
  if (f?.bearbeiter) meta.push(`Bearbeiter: ${f.bearbeiter}`);
  if ((istRe || b.typ === "gutschrift") && (b.leistung_von || b.leistung_bis)) {
    meta.push(b.leistung_von && b.leistung_bis && b.leistung_von !== b.leistung_bis
      ? `Leistungszeitraum: ${datum(b.leistung_von)} – ${datum(b.leistung_bis)}`
      : `Leistungsdatum: ${datum(b.leistung_von || b.leistung_bis)}`);
  }
  if (istRe && b.faellig_am) meta.push(`Zahlbar bis: ${datum(b.faellig_am)}`);
  if (b.typ === "angebot" && b.gueltig_bis) meta.push(`Gültig bis: ${datum(b.gueltig_bis)}`);
  if (vorgaengerNr) meta.push(`${b.typ === "gutschrift" ? "zu Rechnung" : "Angebot"}: ${vorgaengerNr}`);
  const bank = [f?.bank ? `Institut ${f.bank}` : null, f?.iban ? `IBAN ${f.iban}` : null, f?.bic ? `BIC ${f.bic}` : null].filter(Boolean).join("  •  ");
  const sitz = f?.plz_ort ? String(f.plz_ort).replace(/^\d{4}\s*/, "") : "";
  const recht = [firmaName, sitz ? `Sitz: ${sitz}` : null, f?.firmenbuch ? `FN ${String(f.firmenbuch).replace(/^FN\s*/i, "")}` : null, f?.gericht || null, f?.uid ? `UID ${f.uid}` : null, f?.fusstext || null].filter(Boolean).join("  •  ");

  const hinweise: string[] = [];
  if (b.reverse_charge) hinweise.push("Übergang der Steuerschuld gemäß § 19 Abs. 1a UStG (Bauleistung). Die Rechnung enthält keine Umsatzsteuer; Steuerschuldner ist der Leistungsempfänger.");
  if (istRe) {
    const skonto = b.skonto_prozent && b.skonto_tage ? ` — bei Zahlung innerhalb von ${b.skonto_tage} Tagen ${fmtZahl.format(Number(b.skonto_prozent))} % Skonto` : "";
    hinweise.push(`Zahlbar bis ${datum(b.faellig_am)} ohne Abzug${skonto}. Bitte überweisen Sie den Betrag auf das unten angeführte Konto — Verwendungszweck: ${b.nummer ?? titel}.`);
  }
  if (b.typ === "gutschrift") hinweise.push("Der Betrag wird auf das uns bekannte Konto überwiesen bzw. mit offenen Forderungen verrechnet.");
  if (b.schlusstext) hinweise.push(b.schlusstext);

  let nr = 0;
  const grau = "#e4e4e4";

  return (
    <div ref={aussen} style={{ width: "100%", height: mass.h || undefined, position: "relative" }}>
      <div
        ref={blatt}
        data-belegblatt
        style={{
          width: "210mm", boxSizing: "border-box", padding: "14mm 18mm 8mm 18mm", minHeight: "297mm",
          background: "#fff", color: "#000", fontFamily: "Helvetica, Arial, sans-serif", fontSize: "9.5pt", lineHeight: 1.3,
          boxShadow: "0 2px 12px rgba(0,0,0,.18)", transform: `scale(${mass.k})`, transformOrigin: "top left", position: "absolute", top: 0, left: 0,
          display: "flex", flexDirection: "column",
        }}
      >
        {entwurf && (
          <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: "38%", textAlign: "center", transform: "rotate(-40deg)", fontSize: "60pt", fontWeight: 700, color: "#e1e1e1", pointerEvents: "none", userSelect: "none" }}>ENTWURF</div>
        )}

        {/* Briefkopf */}
        <div style={{ display: "grid", gridTemplateColumns: "46mm 1fr 60mm", alignItems: "start", minHeight: "30mm" }}>
          <img src="/ruff-logo.png" alt="" style={{ width: "46mm", height: "30mm", objectFit: "contain" }} />
          <div style={{ textAlign: "center", fontSize: "15pt", paddingTop: "6mm", paddingLeft: "6mm" }}>{firmaName}</div>
          <div style={{ textAlign: "right", fontSize: "9pt", color: "#1e1e1e", lineHeight: 1.35 }}>{kopfRechts.map((t, i) => <div key={i}>{t}</div>)}</div>
        </div>
        <div style={{ borderTop: "0.3mm solid #bebebe", margin: "2mm 0 7mm" }} />

        {/* Absender + Empfänger | Kundeninfo */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 70mm", gap: "16mm", alignItems: "start" }}>
          <div>
            <div style={{ fontSize: "6.5pt", color: "#5a5a5a", borderBottom: "0.2mm solid #969696", paddingBottom: "0.5mm", width: "88mm" }}>
              Abs.: {[firmaName, f?.strasse, f?.plz_ort].filter(Boolean).join(" • ")}
            </div>
            <div style={{ fontSize: "10.5pt", marginTop: "4mm", lineHeight: 1.45, width: "88mm" }}>
              {empf.length ? empf.map((t, i) => <div key={i}>{t}</div>) : <div style={{ color: "#999" }}>Empfänger fehlt</div>}
            </div>
          </div>
          {info.length > 0 && (
            <div style={{ border: "0.3mm solid #c8c8c8", borderRadius: "1.5mm", background: "#fcfcfc", padding: "3mm 4mm", fontSize: "9pt" }}>
              <div style={{ fontWeight: 700, fontSize: "9.5pt", marginBottom: "2mm" }}>Kundeninfo</div>
              {info.map(([k, v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "24mm 1fr", gap: "1mm", lineHeight: 1.35, wordBreak: "break-word" }}><span>{k}</span><span>{v}</span></div>
              ))}
            </div>
          )}
        </div>

        {/* Titel + Meta */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8mm", marginTop: "12mm" }}>
          <div style={{ fontWeight: 700, fontSize: "13pt", maxWidth: "105mm" }}>{titel}</div>
          <div style={{ textAlign: "right", fontSize: "9.5pt", lineHeight: 1.35 }}>{meta.map((t, i) => <div key={i}>{t}</div>)}</div>
        </div>
        {b.betreff && <div style={{ fontWeight: 700, fontSize: "10pt", marginTop: "3mm" }}>{b.betreff}</div>}
        {b.einleitung && <Absatz text={b.einleitung} className="" />}

        {/* Tabelle */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "4mm", fontSize: "9.5pt" }}>
          <thead>
            <tr style={{ background: grau, fontWeight: 700, color: "#1e1e1e" }}>
              <th style={{ textAlign: "left", padding: "1.4mm 1.5mm", width: "11mm" }}>Pos</th>
              <th style={{ textAlign: "left", padding: "1.4mm 1mm" }}>Beschreibung</th>
              <th style={{ textAlign: "right", padding: "1.4mm 1mm", width: "26mm" }}>Einzelpreis €</th>
              <th style={{ textAlign: "right", padding: "1.4mm 1mm", width: "24mm" }}>Menge</th>
              <th style={{ textAlign: "right", padding: "1.4mm 1mm 1.4mm 1mm", width: "24mm" }}>Summe €</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.length === 0 && (
              <tr><td colSpan={5} style={{ padding: "4mm 1mm", color: "#999", textAlign: "center" }}>Noch keine Positionen</td></tr>
            )}
            {zeilen.map((p) => {
              if (p.art === "ueberschrift") return <tr key={p.id}><td /><td colSpan={4} style={{ padding: "2.2mm 1mm 0.6mm", fontWeight: 700, fontSize: "10pt" }}>{p.text}</td></tr>;
              if (p.art === "text") return <tr key={p.id}><td /><td colSpan={4} style={{ padding: "1.6mm 1mm 0.6mm", color: "#464646", fontSize: "9pt" }}>{p.text}</td></tr>;
              nr += 1;
              const rabatt = Number(p.rabatt_prozent ?? 0);
              return (
                <tr key={p.id} style={{ verticalAlign: "top" }}>
                  <td style={{ padding: "2.2mm 1.5mm 0.8mm" }}>{nr}</td>
                  <td style={{ padding: "2.2mm 1mm 0.8mm" }}>
                    <div style={{ fontWeight: 700 }}>{p.text || <span style={{ color: "#bbb", fontWeight: 400 }}>Bezeichnung…</span>}</div>
                    {p.beschreibung && <div style={{ color: "#505050", fontSize: "8.5pt", marginTop: "0.6mm", whiteSpace: "pre-wrap" }}>{p.beschreibung}</div>}
                    {rabatt > 0 && <div style={{ color: "#6e6e6e", fontSize: "7.5pt", marginTop: "0.6mm" }}>abzgl. {fmtZahl.format(rabatt)} % Rabatt</div>}
                  </td>
                  <td style={{ padding: "2.2mm 1mm 0.8mm", textAlign: "right", whiteSpace: "nowrap" }}>{betrag(p.einzelpreis)}</td>
                  <td style={{ padding: "2.2mm 1mm 0.8mm", textAlign: "right", whiteSpace: "nowrap" }}>{menge2(p.menge)} {p.einheit}</td>
                  <td style={{ padding: "2.2mm 1mm 0.8mm", textAlign: "right", whiteSpace: "nowrap" }}>{betrag(p.gesamt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Summen */}
        <div style={{ borderTop: "0.3mm solid #787878", marginTop: "3mm", paddingTop: "4mm", display: "flex", justifyContent: "flex-end" }}>
          <table style={{ width: "64mm", borderCollapse: "collapse", fontSize: "9.5pt" }}>
            <tbody>
              <tr><td style={{ padding: "0.8mm 0" }}>Netto</td><td style={{ textAlign: "right" }}>{betrag(netto)}</td></tr>
              <tr><td style={{ padding: "0.8mm 0" }}>{b.reverse_charge ? "Umsatzsteuer: Übergang der Steuerschuld" : `${fmtZahl.format(Number(b.ust_satz ?? 0))}% MwSt`}</td><td style={{ textAlign: "right" }}>{betrag(ust)}</td></tr>
              <tr style={{ fontWeight: 700, fontSize: "10.5pt" }}>
                <td style={{ padding: "1.2mm 0", borderTop: "0.4mm solid #000", borderBottom: "0.3mm double #000" }}>{b.typ === "gutschrift" ? "Gutschriftsbetrag €" : "Gesamtbetrag €"}</td>
                <td style={{ textAlign: "right", borderTop: "0.4mm solid #000", borderBottom: "0.3mm double #000" }}>{betrag(brutto)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Hinweise / Angebotstexte */}
        <div style={{ marginTop: "5mm" }}>
          {hinweise.map((h, i) => <Absatz key={i} text={h} className="mb-[3mm]" />)}
          {istAngebot && (
            <>
              {b.gueltig_bis && <div style={{ fontSize: "9.5pt", marginBottom: "4mm" }}>Preisgültigkeit: bis {datum(b.gueltig_bis)}</div>}
              {f?.angebot_bedingungen && (
                <>
                  <div style={{ fontWeight: 700, fontSize: "10pt", marginBottom: "1.5mm" }}>Auftragsbedingungen:</div>
                  <Absatz text={f.angebot_bedingungen} pt={9} className="mb-[5mm]" />
                </>
              )}
              {f?.angebot_zahlung && <Absatz text={f.angebot_zahlung} className="mb-[2mm]" />}
              <Unterschriften links="Ort, Datum" rechts="Unterschrift des Auftraggebers" />
              {f?.angebot_widerruf_zeigen !== false && f?.angebot_widerruf && (
                <>
                  <div style={{ fontWeight: 700, fontSize: "10pt", marginBottom: "1.5mm" }}>Widerrufsbelehrung nach Fern- und Auswärtsgeschäfte-Gesetz (FAGG)</div>
                  <Absatz text={f.angebot_widerruf} pt={9} className="mb-[2mm]" />
                  <Unterschriften links="Ort, Datum" rechts="Unterschrift Kunde" />
                </>
              )}
            </>
          )}
        </div>

        {/* Fußzeile */}
        <div style={{ marginTop: "auto", paddingTop: "8mm" }}>
          <div style={{ borderTop: "0.3mm solid #aaa", paddingTop: "1.5mm", textAlign: "center" }}>
            <div style={{ fontWeight: 700, fontSize: "8.5pt" }}>Bankverbindung</div>
            {bank && <div style={{ fontSize: "8pt" }}>{bank}</div>}
            <div style={{ fontSize: "6.5pt", color: "#6e6e6e", marginTop: "1mm" }}>{recht}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BelegBlatt;
