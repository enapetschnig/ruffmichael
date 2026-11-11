import { test, expect } from "@playwright/test";
import {
  APP, abgelehnteAbfragen, anmelden, freierTag, keineEchteDatenbank, kontoAusDaten, pdfText, sperrenSetzen, sql, type Konto,
} from "./grundtest-hilfe";

// Grundablauf Arbeitsbestätigung (.claude/rules/arbeitsbestaetigung.md): Mitarbeiter erfasst einen Auftrag beim
// Kunden, Stunden landen in der Zeiterfassung, das PDF heißt »Auftrag und Arbeitsbestätigung für Regieleistung«.
// Hier gilt die Pausenautomatik bewusst NICHT (Kundenverrechnung): 11:00–14:00 ohne Pause = 3 h.
// Das PDF kommt aus der echten Funktion send-disturbance-report (Modus nurPdf) – eine Mail geht nie hinaus.
const marke = Date.now();
const kunde = `Grundtest Kunde ${marke}`;
const arbeit = `Grundtest Therme entlüftet ${marke}`;

test.describe("Grundablauf Arbeitsbestätigung", () => {
  let mitarbeiter: Konto;
  let tag: string;
  const berichtIds = () => sql(`select id from public.disturbances where kunde_name = '${kunde}'`).split("\n").filter(Boolean);

  test.beforeAll(() => {
    mitarbeiter = kontoAusDaten("mitarbeiter");
    tag = freierTag(mitarbeiter.id, 900);
  });
  test.afterAll(() => {
    const ids = berichtIds().map((i) => `'${i}'`).join(",");
    if (!ids) return;
    sql(`set session_replication_role = replica;
         delete from public.time_entries where disturbance_id in (${ids});
         delete from public.disturbance_materials where disturbance_id in (${ids});
         delete from public.disturbance_workers where disturbance_id in (${ids});
         delete from public.disturbances where id in (${ids});`);
  });

  test("Mitarbeiter erfasst Auftrag, Stunden ohne Pausenautomatik, PDF mit Formulartitel, kein Versand", async ({ page }) => {
    const wache = await sperrenSetzen(page);
    await anmelden(page, mitarbeiter);
    await page.goto(`${APP}/disturbances`);
    await page.getByRole("button", { name: /Neuer Auftrag|Entwurf fortsetzen/ }).click();

    await page.locator("#datum").fill(tag);
    await page.locator("#startTime").fill("11:00");
    await page.locator("#endTime").fill("14:00");
    await page.locator("#kundeName").fill(kunde);
    await page.locator("#beschreibung").fill(arbeit);
    await page.getByRole("button", { name: "Auftrag erfassen" }).click();

    // Nach dem Speichern: Detailseite, Unterschriftsfenster für den Kunden geht von selbst auf.
    await expect(page).toHaveURL(/\/disturbances\/[0-9a-f-]{36}/, { timeout: 20_000 });
    expect(berichtIds()).toHaveLength(1);
    const id = berichtIds()[0];
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const [stunden, pause, wer] = sql(`select stunden, pause_minutes, user_id from public.time_entries where disturbance_id = '${id}'`).split("|");
    expect(Number(stunden)).toBe(3);
    expect(Number(pause)).toBe(0);
    expect(wer).toBe(mitarbeiter.id);
    expect(sql(`select status from public.disturbances where id = '${id}'`)).toBe("offen");

    // PDF (auch ohne Unterschrift möglich)
    const [antwort] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/functions/v1/send-disturbance-report"), { timeout: 90_000 }),
      page.getByRole("button", { name: "PDF", exact: true }).click(),
    ]);
    expect(antwort.status()).toBe(200);
    const text = await pdfText(Uint8Array.from(Buffer.from((await antwort.json()).pdf, "base64")));
    expect(text).toMatch(/AUFTRAG UND ARBEITSBEST.TIGUNG/i);
    expect(text).toMatch(/REGIELEISTUNG/i);
    expect(text).toContain(arbeit);
    expect(text).toContain(String(marke));
    expect(text).not.toMatch(/Regiebericht/i);

    // Kein Mailversand, Status unverändert
    expect(wache.funktionen).not.toContain("send-disturbance-report");
    expect(sql(`select status from public.disturbances where id = '${id}'`)).toBe("offen");

    // Der Bericht steht in der Liste
    await page.goto(`${APP}/disturbances`);
    await expect(page.getByText(kunde).first()).toBeVisible();

    expect(abgelehnteAbfragen(wache)).toEqual([]);
    expect(wache.seitenFehler).toEqual([]);
    keineEchteDatenbank(wache);
  });

  test("Anderer Mitarbeiter sieht fremde Arbeitsbestätigung nicht, Administrator schon", async ({ browser }) => {
    test.skip(berichtIds().length === 0, "braucht den Bericht aus dem Test davor");
    const id = berichtIds()[0];
    const anderer = sql(`select u.email from auth.users u join public.user_roles r on r.user_id = u.id
      where r.role = 'mitarbeiter' and u.email like 'nutzer%@example.invalid' and u.id <> '${mitarbeiter.id}' order by u.email limit 1`);
    for (const [konto, sichtbar] of [
      [{ ...mitarbeiter, id: "", email: anderer }, false],
      [kontoAusDaten("administrator"), true],
    ] as const) {
      if (!konto.email) continue;
      const page = await (await browser.newContext()).newPage();
      await sperrenSetzen(page);
      await anmelden(page, konto);
      await page.goto(`${APP}/disturbances`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(kunde), `${konto.email} ${sichtbar ? "sieht" : "sieht fälschlich"} ${id}`).toHaveCount(sichtbar ? 1 : 0);
      await page.context().close();
    }
  });
});
