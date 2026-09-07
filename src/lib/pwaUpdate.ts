// Selbst-Aktualisierung der installierten App.
//
// Problem, das hier gelöst wird: Der Browser prüft den Service Worker nur beim
// Start der App (und höchstens alle 24 h). Eine am Handy installierte App, die
// tagelang offen bleibt, zeigt so dauerhaft die alte Fassung — neue Funktionen
// erscheinen erst nach komplettem Schließen und zweimaligem Neuöffnen.
//
// Lösung: Wir registrieren den Service Worker selbst und stoßen die Prüfung
// regelmäßig an — jede Minute, beim Zurückkehren in die App und wenn das Netz
// wiederkommt. Findet sie eine neue Fassung, übernimmt diese sofort
// (registerType 'autoUpdate') und die Seite lädt einmal neu.
import { registerSW } from "virtual:pwa-register";

const PRUEF_INTERVALL_MS = 60 * 1000;

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const pruefen = () => {
      // Nur online prüfen — offline würde der Aufruf nur Fehler ins Log schreiben
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      registration.update().catch(() => { /* still ignorieren */ });
    };
    setInterval(pruefen, PRUEF_INTERVALL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") pruefen();
    });
    window.addEventListener("online", pruefen);
  },
});
