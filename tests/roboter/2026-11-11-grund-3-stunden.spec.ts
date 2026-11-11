import { test, expect } from "@playwright/test";
import { APP, abgelehnteAbfragen, anmelden, freierTag, keineEchteDatenbank, kontoAusDaten, sperrenSetzen, sql, type Konto } from "./grundtest-hilfe";

// Grundablauf Stunden erfassen (.claude/rules/zeiterfassung.md): Mittagspause 12:00–12:30 kommt IMMER automatisch
// dazu und zählt nie als Arbeitszeit – auch wenn jemand die Pausenfelder leert. 07:00–16:00 = 8,5 h, nicht 9 h.
test.describe("Grundablauf Stunden", () => {
  let mitarbeiter: Konto;
  let tag: string;
  const meineEintraege = () => sql(`select id from public.time_entries where user_id = '${mitarbeiter.id}' and datum = '${tag}'`)
    .split("\n").filter(Boolean);

  test.beforeAll(() => {
    mitarbeiter = kontoAusDaten("mitarbeiter");
    tag = freierTag(mitarbeiter.id);
  });
  test.afterAll(() => {
    const ids = meineEintraege().map((i) => `'${i}'`).join(",");
    if (ids) sql(`delete from public.time_entries where id in (${ids})`);
  });

  test("Mitarbeiter bucht 07:00–16:00 ohne Pause → 8,5 h mit Mittagspause, keine Doppelbuchung", async ({ page }) => {
    const wache = await sperrenSetzen(page);
    await anmelden(page, mitarbeiter);
    await page.goto(`${APP}/time-tracking`);
    await page.locator("#date").fill(tag);
    // Erst den Tag fertig laden lassen – er setzt die Zeitfelder neu und würde Eingaben überschreiben.
    await page.waitForLoadState("networkidle");

    const zeiten = page.locator('form input[type="time"]');
    await zeiten.nth(0).fill("07:00");
    await zeiten.nth(1).fill("16:00");
    // Pause vergessen: beide Pausenfelder leeren – das Sicherheitsnetz beim Speichern muss sie wieder eintragen.
    await zeiten.nth(2).fill("");
    await zeiten.nth(3).fill("");
    await page.getByRole("button", { name: "Stunden erfassen" }).click();

    await expect.poll(() => meineEintraege().length, { timeout: 20_000 }).toBe(1);
    const [stunden, pause, von, bis, ort] = sql(`select stunden, pause_minutes, pause_start, pause_end, location_type
      from public.time_entries where user_id = '${mitarbeiter.id}' and datum = '${tag}'`).split("|");
    expect(Number(stunden)).toBe(8.5);
    expect(Number(pause)).toBe(30);
    expect(von.slice(0, 5)).toBe("12:00");
    expect(bis.slice(0, 5)).toBe("12:30");
    expect(ort).toBe("baustelle");

    // Zweimal am selben Tag dieselbe Zeit geht nicht (Überschneidung).
    await page.reload();
    await page.locator("#date").fill(tag);
    await expect(page.getByText("Bereits gebuchte Zeiten")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await zeiten.nth(0).fill("08:00");
    await zeiten.nth(1).fill("10:00");
    await page.getByRole("button", { name: "Stunden erfassen" }).click();
    await expect(page.getByText("Zeitüberschneidung").first()).toBeVisible();
    expect(meineEintraege()).toHaveLength(1);

    expect(abgelehnteAbfragen(wache)).toEqual([]);
    expect(wache.seitenFehler).toEqual([]);
    keineEchteDatenbank(wache);
  });
});
