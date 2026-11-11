import { test, expect, type Page } from "@playwright/test";
import { funktionsPort } from "./funktionen";
import {
  ANON, APP, abgelehnteAbfragen, anmelden, keineEchteDatenbank, kontoAusDaten, lesenAls, sperrenSetzen, tokenHolen,
} from "./grundtest-hilfe";

// Grundablauf Rechte (CLAUDE.md »Rollen«, »Mitarbeiter sehen nie Preise«): Angebote/Rechnungen, E-Mail,
// Eingangsrechnungen, Kalender, Wartungen, Materialpreise nur für Administratoren. Geprüft in der Oberfläche UND direkt
// an der Datenbank – eine versteckte Seite allein schützt nichts.

/** Nur-Admin-Seiten mit eigener Sperre: Mitarbeiter landen wieder auf der Startseite. */
const NUR_ADMIN_SEITEN = ["/belege", "/wartungen", "/admin", "/employees"];
/** Menüpunkte, die ein Mitarbeiter gar nicht erst sieht. */
const NUR_ADMIN_MENUE = ["Angebote", "Rechnungen", "Dokumentenliste", "Posteingang", "Eingangsrechnungen", "Termine (Outlook)", "Wartungen", "Offene Posten", "Stundenauswertung", "Admin-Bereich"];
/** Tabellen mit Preisen, Belegen, Mails – für Mitarbeiter und ohne Anmeldung leer. */
const NUR_ADMIN_TABELLEN = [
  "belege", "beleg_positionen", "beleg_zahlungen", "faktura_nummernkreise", "faktura_stundensaetze", "faktura_firmendaten",
  "material_prices", "mails", "mail_anhaenge", "eingangsrechnungen", "wartungen",
];

/** Menüknopf – auch mit Zähler dahinter (»Posteingang 99+«). */
const menue = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\d+\\+?)?$`) });

async function offen(page: Page, pfad: string) {
  await page.goto(`${APP}${pfad}`);
  await expect(page.getByText("Einen Moment…")).toHaveCount(0);
  await expect(page.getByRole("button").locator("visible=true").first(), `${pfad} lädt nicht`).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page, `${pfad} hat weitergeleitet`).toHaveURL(new RegExp(`${pfad.replace(/\?.*/, "")}(\\?.*)?$`));
}

test.describe("Grundablauf Rechte", () => {
  test("Mitarbeiter: kein Menüpunkt und keine Seite für Belege, Mail, Wartungen, Verwaltung", async ({ page }) => {
    const wache = await sperrenSetzen(page);
    await anmelden(page, kontoAusDaten("mitarbeiter"));
    await expect(page.getByRole("button", { name: "Zeiterfassung", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    for (const name of NUR_ADMIN_MENUE) {
      await expect(menue(page, name), `Menüpunkt ${name}`).toHaveCount(0);
    }
    for (const pfad of NUR_ADMIN_SEITEN) {
      await page.goto(`${APP}${pfad}`);
      await expect(page, `${pfad} müsste gesperrt sein`).toHaveURL(new RegExp(`^${APP}/?$`));
    }
    for (const pfad of ["/time-tracking", "/my-hours", "/projects", "/disturbances", "/materialien", "/nachtraege"]) {
      await offen(page, pfad);
    }
    expect(wache.seitenFehler).toEqual([]);
    keineEchteDatenbank(wache);
  });

  test("Administrator: alle Hauptseiten öffnen sich mit echten Daten ohne Absturz", async ({ page }) => {
    const wache = await sperrenSetzen(page);
    await anmelden(page, kontoAusDaten("administrator"));
    for (const name of ["Angebote", "Posteingang", "Wartungen", "Admin-Bereich"]) {
      await expect(menue(page, name)).toBeVisible();
    }
    for (const pfad of [
      "/", "/belege", "/belege?tab=rechnungen", "/postfach", "/eingangsrechnungen", "/kalender", "/wartungen", "/customers",
      "/materialien", "/nachtraege", "/uebernahmen", "/projects", "/disturbances", "/time-tracking", "/my-hours",
      "/hours-report", "/admin", "/employees", "/reports",
    ]) {
      await offen(page, pfad);
      expect(wache.seitenFehler, `Absturz auf ${pfad}`).toEqual([]);
      expect(abgelehnteAbfragen(wache), `abgelehnte Abfrage auf ${pfad}`).toEqual([]);
    }
    keineEchteDatenbank(wache);
  });

  test("Datenbank: ohne Anmeldung nichts lesbar", async () => {
    for (const tabelle of [...NUR_ADMIN_TABELLEN, "profiles", "customers", "projects", "time_entries", "disturbances", "materials"]) {
      const { zeilen } = await lesenAls(null, `${tabelle}?select=*&limit=1`);
      expect(zeilen, `${tabelle} ist ohne Anmeldung lesbar`).toEqual([]);
    }
  });

  test("Datenbank: Mitarbeiter liest keine Belege, Preise, Mails und fremden Stunden", async () => {
    const mitarbeiter = kontoAusDaten("mitarbeiter");
    const token = await tokenHolen(mitarbeiter);
    for (const tabelle of NUR_ADMIN_TABELLEN) {
      const { zeilen } = await lesenAls(token, `${tabelle}?select=*&limit=1`);
      expect(zeilen, `${tabelle} ist für Mitarbeiter lesbar`).toEqual([]);
    }
    for (const tabelle of ["time_entries", "disturbances"]) {
      const fremd = await lesenAls(token, `${tabelle}?select=id&user_id=neq.${mitarbeiter.id}&limit=1`);
      expect(fremd.zeilen, `fremde ${tabelle} sind für Mitarbeiter lesbar`).toEqual([]);
    }

    // Gegenprobe: Der Administrator sieht diese Daten – sonst wären die Prüfungen oben wertlos.
    const chef = await tokenHolen(kontoAusDaten("administrator"));
    for (const tabelle of ["belege", "material_prices", "mails", "eingangsrechnungen"]) {
      expect((await lesenAls(chef, `${tabelle}?select=*&limit=1`)).zeilen, `Admin sieht ${tabelle} nicht`).toHaveLength(1);
    }
    expect((await lesenAls(chef, `time_entries?select=id&user_id=neq.${mitarbeiter.id}&limit=1`)).zeilen).toHaveLength(1);
  });

  test("Serverfunktionen: PDF und Mailversand nur mit Anmeldung, Belege-PDF nur für Administratoren", async () => {
    // Fund 11.11.2026: send-disturbance-report nahm den öffentlichen Anon-Schlüssel und hätte damit aus Michaels
    // Outlook an eine beliebige Adresse geschickt. Hier im Modus nurPdf geprüft – es geht nie eine Mail hinaus.
    const bericht = { disturbance: { id: "00000000-0000-0000-0000-000000000000", datum: "2026-01-14", start_time: "08:00", end_time: "09:00", pause_minutes: 0, stunden: 1, kunde_name: "Grundtest Kunde", beschreibung: "Grundtest" }, materials: [], photos: [], technicianNames: ["Grundtest"], nurPdf: true };
    const rufen = (fn: "beleg-pdf" | "send-disturbance-report", token: string, body: unknown) =>
      fetch(`http://127.0.0.1:${funktionsPort(fn)}/`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });

    expect((await rufen("send-disturbance-report", ANON, bericht)).status).toBe(401);
    const mitarbeiter = await tokenHolen(kontoAusDaten("mitarbeiter"));
    const ok = await rufen("send-disturbance-report", mitarbeiter, bericht);
    expect(ok.status).toBe(200);
    expect((await ok.json()).pdf).toBeTruthy();

    expect((await rufen("beleg-pdf", ANON, { belegId: "x" })).status).toBe(401);
    expect((await rufen("beleg-pdf", mitarbeiter, { belegId: "x" })).status).toBe(403);
  });
});
