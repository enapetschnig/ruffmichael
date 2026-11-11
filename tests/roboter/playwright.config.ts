import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

// Tests des Roboters – NUR gegen die Testumgebung in Docker, nie gegen die echte Datenbank.
//   node ~/Developer/_baukasten/werkzeuge/roboter/testumgebung.mjs start
//   node ~/Developer/_baukasten/werkzeuge/roboter/testumgebung.mjs daten
//   npx playwright test -c tests/roboter
// Adressen und Schlüssel liest diese Datei bei jedem Lauf aus der Testumgebung, damit nichts davon im Repo steht
// und der wechselnde Portbereich (je Projekt ein freier »Platz«) keine Rolle spielt.
const WERKZEUG = `${process.env.HOME}/Developer/_baukasten/werkzeuge/roboter/testumgebung.mjs`;

if (!process.env.TEST_API_URL) {
  let ausgabe = "";
  try {
    ausgabe = execFileSync("node", [WERKZEUG, "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch { /* unten: klare Meldung */ }
  const wert = (name: string) => ausgabe.match(new RegExp(`^\\s*${name}\\s+(\\S+)`, "m"))?.[1] ?? "";
  if (!wert("API_URL")) throw new Error("Es läuft keine Testumgebung – erst »testumgebung.mjs start« und »daten«.");
  process.env.TEST_API_URL = wert("API_URL");
  process.env.TEST_ANON_KEY = wert("ANON_KEY");
  process.env.TEST_SERVICE_ROLE_KEY = wert("SERVICE_ROLE_KEY");
  process.env.TEST_APP_URL = `http://127.0.0.1:${wert("App-Port")}`;
}

// Wächter: Die App liest sonst ihre .env und damit die echte Datenbank des Kunden.
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.TEST_API_URL)) {
  throw new Error("TEST_API_URL zeigt nicht auf die lokale Testumgebung – Abbruch.");
}

const port = new URL(process.env.TEST_APP_URL ?? "").port;

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../test-results/roboter",
  // Startet die echten PDF-Funktionen (beleg-pdf, send-disturbance-report) in Docker gegen die Testdatenbank.
  globalSetup: "./funktionen.ts",
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    locale: "de-AT",
    timezoneId: "Europe/Vienna",
    screenshot: "only-on-failure",
    // Ein Service Worker würde an den Sperren in grundtest-hilfe.ts vorbei ins Netz gehen.
    serviceWorkers: "block",
    actionTimeout: 20_000,
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "../..",
    url: process.env.TEST_APP_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    // Umgebungsvariablen schlagen die .env der App – die .env selbst bleibt unberührt.
    env: {
      VITE_SUPABASE_URL: process.env.TEST_API_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.TEST_ANON_KEY ?? "",
    },
  },
});
