import { test, expect } from "@playwright/test";
import {
  ANON, API, APP, tokenHolen, abgelehnteAbfragen, anmelden, dienst, keineEchteDatenbank, kontoAusDaten, pdfText, speicherLesen, speicherLoeschen,
  sperrenSetzen, sql, type Konto,
} from "./grundtest-hilfe";

// Grundablauf Rechnung (.claude/rules/faktura-belege.md): Admin legt eine Rechnung ohne Projekt an, »12,50« bleibt
// 12,50 (Komma!), »Rechnung erstellen« vergibt die Nummer, die echte Funktion beleg-pdf legt das PDF ab, das PDF zeigt
// Nummer, Kunde, Position und Betrag; danach ist die Rechnung gesperrt und nicht löschbar.
// Ohne Projekt landet das PDF unter _ohne_projekt/ (kein OneDrive). Nummernkreis wird danach zurückgesetzt.
const marke = Date.now();
const nachname = `Grundtest${marke}`;
const position = `Grundtest Heizungsventil ${marke}`;

test.describe("Grundablauf Rechnung", () => {
  let chef: Konto;
  let kundeId = "";
  let zaehlerVorher = "";
  let zaehlerStart = "";
  const belegIds = () => (kundeId ? sql(`select id from public.belege where customer_id = '${kundeId}'`).split("\n").filter(Boolean) : []);

  test.beforeAll(async () => {
    chef = kontoAusDaten("administrator");
    zaehlerVorher = sql(`select naechste_nummer from public.faktura_nummernkreise where kreis = 'rechnung'`);
    // Die Kopie der Echtdaten bringt den Zähler nicht immer im Live-Stand mit (dort gilt: höchste Nummer + 1).
    sql(`update public.faktura_nummernkreise set naechste_nummer = greatest(naechste_nummer,
           (select coalesce(max(laufnummer), 0) + 1 from public.belege where kreis = 'rechnung')) where kreis = 'rechnung'`);
    zaehlerStart = sql(`select naechste_nummer from public.faktura_nummernkreise where kreis = 'rechnung'`);
    const [kunde] = await dienst("/rest/v1/customers", "POST",
      { vorname: "Grundtest", nachname, strasse: "Teststraße 1", ort: "2601 Eggendorf" }, { Prefer: "return=representation" });
    kundeId = kunde.id;
  });

  test.afterAll(async () => {
    const ids = belegIds().map((i) => `'${i}'`).join(",");
    if (ids) {
      const pfade = sql(`select pdf_pfad from public.belege where id in (${ids}) and pdf_pfad is not null`).split("\n").filter(Boolean);
      for (const p of pfade) await speicherLoeschen("project-files", p);
      sql(`set session_replication_role = replica;
           delete from public.beleg_zahlungen where beleg_id in (${ids});
           delete from public.beleg_positionen where beleg_id in (${ids});
           delete from public.belege where id in (${ids});`);
    }
    if (zaehlerVorher) sql(`update public.faktura_nummernkreise set naechste_nummer = ${zaehlerVorher} where kreis = 'rechnung'`);
    if (kundeId) sql(`delete from public.customers where id = '${kundeId}'`);
  });

  test("Rechnung anlegen, Komma-Preis, erstellen → Nummer, PDF stimmt, danach gesperrt", async ({ page }) => {
    const wache = await sperrenSetzen(page);
    await anmelden(page, chef);
    await page.goto(`${APP}/belege`);
    await page.getByRole("button", { name: "Neuer Beleg" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /^Rechnung/ }).click();
    await dialog.getByPlaceholder(/Kunde suchen/).fill(nachname);
    await dialog.getByRole("option", { name: new RegExp(nachname) }).click();
    await dialog.getByRole("button", { name: "Anlegen" }).click();

    await expect(page).toHaveURL(/\/belege\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    expect(belegIds()).toHaveLength(1);
    const id = belegIds()[0];
    expect(sql(`select typ || '|' || status || '|' || coalesce(nummer, '-') from public.belege where id = '${id}'`)).toBe("rechnung|entwurf|-");

    // Position: 2 × 12,50 € (österreichische Schreibweise)
    await page.getByRole("button", { name: "Position", exact: true }).click();
    await page.getByPlaceholder("Bezeichnung — tippen für Artikelvorschläge").first().fill(position);
    await page.keyboard.press("Escape");
    const zeile = page.locator("div.rounded-md.border").filter({ has: page.getByPlaceholder("Bezeichnung — tippen für Artikelvorschläge") }).first();
    const zahl = (beschriftung: string) => zeile.locator("div.space-y-1").filter({ has: page.locator(`label:text-is("${beschriftung}")`) }).locator("input");
    await zahl("Menge").fill("2");
    await zahl("Menge").blur();
    await zahl("Einzelpreis €").fill("12,50");
    await zahl("Einzelpreis €").blur();
    await expect.poll(() => sql(`select text || '|' || menge::float8 || '|' || einzelpreis::float8 from public.beleg_positionen where beleg_id = '${id}'`), { timeout: 15_000 })
      .toBe(`${position}|2|12.5`);
    await expect.poll(() => sql(`select netto::float8 || '|' || brutto::float8 from public.belege where id = '${id}'`)).toBe("25|30");

    // Rechnung erstellen → Nummer, PDF über die echte Funktion
    await page.getByRole("button", { name: "Rechnung erstellen" }).first().click();
    const pdfAntwort = page.waitForResponse((r) => r.url().includes("/functions/v1/beleg-pdf"), { timeout: 90_000 });
    const [rpc] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/rpc/beleg_festschreiben")),
      page.getByRole("alertdialog").getByRole("button", { name: "Rechnung erstellen" }).click(),
    ]);
    expect(rpc.status(), await rpc.text()).toBeLessThan(300);
    const antwort = await pdfAntwort;
    expect(antwort.status(), await antwort.text()).toBe(200);
    const [status, nummer, pfad] = sql(`select status || '|' || coalesce(nummer, '') || '|' || coalesce(pdf_pfad, '') from public.belege where id = '${id}'`).split("|");
    expect(status).not.toBe("entwurf");
    expect(nummer).not.toBe("");
    expect(pfad).toMatch(/^_ohne_projekt\//);
    expect(sql(`select naechste_nummer from public.faktura_nummernkreise where kreis = 'rechnung'`)).toBe(String(Number(zaehlerStart) + 1));

    const text = await pdfText(await speicherLesen("project-files", pfad));
    expect(text).toContain(nummer);
    expect(text).toContain(nachname);
    expect(text).toContain(position);
    expect(text).toMatch(/12,50/);
    expect(text).toMatch(/30,00/);

    // Danach gesperrt: kein »Rechnung erstellen«, kein Löschen; die Datenbank lehnt Änderungen ab.
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByText(nummer).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Rechnung erstellen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Löschen" })).toHaveCount(0);
    // … auch für den Administrator direkt an der Datenbank (so, wie die App schreibt).
    const token = await tokenHolen(chef);
    const schreiben = (pfad: string, method: string, body?: unknown) => fetch(`${API}/rest/v1/${pfad}`, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    });
    await schreiben(`beleg_positionen?beleg_id=eq.${id}`, "PATCH", { einzelpreis: 99 });
    await schreiben(`belege?id=eq.${id}`, "DELETE");
    expect(sql(`select einzelpreis::float8 from public.beleg_positionen where beleg_id = '${id}'`)).toBe("12.5");
    expect(belegIds()).toEqual([id]);

    // Keine Mail, kein OneDrive – nur der Kalender der Startseite liest aus Outlook.
    expect(wache.funktionen.filter((f) => f !== "outlook:kalender")).toEqual([]);
    expect(abgelehnteAbfragen(wache)).toEqual([]);
    expect(wache.seitenFehler).toEqual([]);
    keineEchteDatenbank(wache);
  });
});
