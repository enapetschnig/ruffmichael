// Frühe, robuste Erfassung des Installations-Prompts der App (Chrome/Edge auf
// Windows, macOS und Android). Das 'beforeinstallprompt'-Event kann bereits
// feuern, BEVOR React gemountet ist – deshalb hören wir so früh wie möglich
// (dieses Modul wird ganz oben in main.tsx importiert) und legen das Event
// global ab, damit der Installieren-Button es später mit EINEM Klick auslösen
// kann. Zusätzlich stellen wir eine kleine Plattform-/Browser-Erkennung bereit,
// damit für jedes Gerät (Windows, Mac, iPhone/iPad, Android) die passende
// Installationsanleitung angezeigt werden kann.

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((cb) => cb());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Standard-Mini-Infobar unterdrücken – wir steuern den Zeitpunkt selbst
    // über den eigenen "Jetzt installieren"-Button im Dialog.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });
}

/** True, sobald der Browser eine Ein-Klick-Installation erlaubt (Chrome/Edge). */
export function canInstallDirectly(): boolean {
  return deferredPrompt !== null;
}

/** True, wenn die App bereits als eigenständige App läuft/installiert ist. */
export function isAppInstalled(): boolean {
  if (installed) return true;
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  // iOS-Safari nutzt statt display-mode das nicht-standardisierte navigator.standalone.
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

/**
 * Löst den nativen Installationsdialog aus (ein Klick). Das Event ist nur
 * EINMAL verwendbar – nach Gebrauch wird es verworfen. Gibt "unavailable"
 * zurück, wenn keine Direktinstallation möglich ist (dann Anleitung zeigen).
 */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  if (!deferredPrompt) return "unavailable";
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  emit();
  return outcome;
}

/** Abonniert Änderungen (Prompt verfügbar / App installiert). Gibt Unsubscribe zurück. */
export function onInstallStateChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Plattform-/Browser-Erkennung (nur für die Auswahl der richtigen Anleitung)
// ---------------------------------------------------------------------------

export type PlatformKind = "ios" | "android" | "windows" | "macos" | "other";
export type BrowserKind = "chromium" | "safari" | "firefox" | "other";

export function detectPlatform(): PlatformKind {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const platform = navigator.platform || "";
  // iPadOS 13+ meldet sich als "Macintosh". Kanonische Unterscheidung: echte
  // Macs haben maxTouchPoints 0, iPads 5. So wird ein Touch-Mac NICHT als iOS
  // fehlklassifiziert (und ein iPad nicht als macOS).
  const isIPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || isIPad) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Win/.test(platform) || /Windows/.test(ua)) return "windows";
  if (/Mac/.test(platform) || /Mac OS X/.test(ua)) return "macos";
  return "other";
}

export function detectBrowser(): BrowserKind {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  // Auf iOS sind ALLE Browser (Chrome=CriOS, Firefox=FxiOS, Edge=EdgiOS …) nur
  // WebKit-Hüllen: sie feuern kein beforeinstallprompt und können nicht per Klick
  // installieren. Daher einheitlich als "safari" behandeln – sonst würde z.B. eine
  // spätere "chromium => Ein-Klick"-Logik iOS-Nutzern etwas Unmögliches versprechen.
  if (detectPlatform() === "ios") return "safari";
  if (/Firefox\//.test(ua)) return "firefox";
  // Edge (Edg/), Chrome, Brave, Opera etc. sind Chromium-basiert – Safari NICHT.
  if (/Edg\//.test(ua) || /Chrome\//.test(ua) || /Chromium\//.test(ua)) {
    return "chromium";
  }
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}
