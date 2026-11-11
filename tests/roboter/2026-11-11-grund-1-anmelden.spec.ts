import { test, expect } from "@playwright/test";
import { APP, anmelden, keineEchteDatenbank, kontoAnlegen, kontoAusDaten, kontoLoeschen, sperrenSetzen, type Konto } from "./grundtest-hilfe";

// Grundablauf Anmelden: Jeder im Betrieb kommt mit seinem Konto rein, Fremde und deaktivierte Konten nicht.
test.describe("Grundablauf Anmelden", () => {
  let deaktiviert: Konto | undefined;

  test.beforeAll(async () => {
    deaktiviert = await kontoAnlegen("deaktiviert", "mitarbeiter", false);
  });
  test.afterAll(async () => {
    await kontoLoeschen(deaktiviert);
  });

  test("Ohne Anmeldung führt jede Seite zur Anmeldung", async ({ page }) => {
    await sperrenSetzen(page);
    for (const pfad of ["/", "/time-tracking", "/disturbances", "/belege", "/postfach", "/admin"]) {
      await page.goto(`${APP}${pfad}`);
      await expect(page, pfad).toHaveURL(/\/auth$/);
    }
  });

  test("Falsches Passwort: bleibt auf der Anmeldeseite, Hinweis erscheint", async ({ page }) => {
    await sperrenSetzen(page);
    await page.goto(`${APP}/auth`);
    await page.locator("#email").fill(kontoAusDaten("mitarbeiter").email);
    await page.locator("#password").fill("ganz-falsch-123");
    await page.locator("#password").press("Enter");
    await expect(page.getByText("Fehler beim Anmelden").first()).toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
  });

  for (const rolle of ["administrator", "mitarbeiter"] as const) {
    test(`${rolle}: Anmelden, Startseite mit Zeiterfassung und Arbeitsbestätigungen erscheint`, async ({ page }) => {
      const wache = await sperrenSetzen(page);
      await anmelden(page, kontoAusDaten(rolle));
      await expect(page.getByRole("button", { name: "Zeiterfassung", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Aufträge & Arbeitsbestätigungen" })).toBeVisible();
      expect(wache.seitenFehler).toEqual([]);
      keineEchteDatenbank(wache);
    });
  }

  test("Deaktiviertes Konto sieht nur »Zugang deaktiviert«", async ({ page }) => {
    await sperrenSetzen(page);
    await anmelden(page, deaktiviert!);
    await expect(page.getByText("Zugang deaktiviert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zeiterfassung", exact: true })).toHaveCount(0);
  });
});
