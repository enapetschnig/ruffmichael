import { execFileSync } from "node:child_process";

// Die Testumgebung startet keine Serverfunktionen (Edge Runtime aus). Die PDFs dieser App entstehen aber am Server
// (beleg-pdf für Angebote/Rechnungen, send-disturbance-report für die Arbeitsbestätigung). Damit die Grundtests das
// echte PDF prüfen und nicht nur »Knopf gedrückt«, laufen genau diese zwei Funktionen hier im Docker-Netz der
// Testumgebung – mit deren Schlüsseln, ohne Microsoft-Zugang (MS_*): Eine Mail kann daraus nie hinausgehen.

export const FUNKTIONEN = ["beleg-pdf", "send-disturbance-report"] as const;
const PROJEKT = "ruffmichael";
const BILD = "public.ecr.aws/supabase/edge-runtime:v1.77.9";

/** Port der Funktion auf 127.0.0.1 – im Portbereich der Testumgebung (API-Port + 30 …). */
export function funktionsPort(name: (typeof FUNKTIONEN)[number]): number {
  return Number(new URL(process.env.TEST_API_URL ?? "").port) + 30 + FUNKTIONEN.indexOf(name);
}
const behaelter = (name: string) => `grundtest-fn-${name}-${PROJEKT}`;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export default async function funktionenStarten() {
  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  for (const name of FUNKTIONEN) {
    try { docker("rm", "-f", behaelter(name)); } catch { /* lief nicht */ }
    docker(
      "run", "-d", "--rm", "--name", behaelter(name),
      "--network", `supabase_network_pf-${PROJEKT}`,
      "-p", `127.0.0.1:${funktionsPort(name)}:9000`,
      "-v", `${repo}/supabase/functions:/functions:ro`,
      "-e", `SUPABASE_URL=http://supabase_kong_pf-${PROJEKT}:8000`,
      "-e", `SUPABASE_ANON_KEY=${process.env.TEST_ANON_KEY}`,
      "-e", `SUPABASE_SERVICE_ROLE_KEY=${process.env.TEST_SERVICE_ROLE_KEY}`,
      BILD, "start", "--main-service", `/functions/${name}`, "-p", "9000",
    );
  }
  // Bereit, wenn die Funktion antwortet (erster Aufruf lädt jsPDF & Co. von esm.sh).
  for (const name of FUNKTIONEN) {
    const bis = Date.now() + 90_000;
    for (;;) {
      try {
        await fetch(`http://127.0.0.1:${funktionsPort(name)}/`, { method: "POST", body: "{}" });
        break;
      } catch { /* startet noch */ }
      if (Date.now() > bis) throw new Error(`Funktion ${name} startet nicht: ${docker("logs", behaelter(name)).slice(-500)}`);
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  }
  return () => {
    for (const name of FUNKTIONEN) { try { docker("rm", "-f", behaelter(name)); } catch { /* schon weg */ } }
  };
}
