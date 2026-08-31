/**
 * Bild vom Bildschirm — für die Änderungswünsche aus der App.
 *
 * Gezeichnet wird mit `modern-screenshot`: Die Seite wandert als SVG
 * (foreignObject) in ein Bild, das heißt DER BROWSER SELBST rendert sie.
 * Dadurch sitzt jeder Text genau dort, wo er auch am Schirm steht.
 *
 * Vorher lief das über html2canvas, das jede CSS-Regel nachbaut — dabei
 * rutschten Texte aus ihrer Zeile und wurden unten abgeschnitten
 * ("Rechnungen & Angebote" halbiert, Menüpunkte angeschnitten). Genau das
 * war der gemeldete Fehler vom 31.08.
 *
 * Bewusst NICHT getDisplayMedia: Das verlangt bei jedem Mal eine Freigabe
 * und gibt es am Handy gar nicht.
 */

/** Was nicht mit aufs Bild soll (z.B. der Melde-Knopf selbst). */
const AUSBLENDEN = '[data-bildschirmfoto="aus"]';

export async function bildschirmfotoMachen(): Promise<string | null> {
  if (typeof document === "undefined") return null;

  try {
    const { domToJpeg } = await import("modern-screenshot");

    // Volle INHALTSBREITE aufnehmen, nicht nur das Fenster: Bei breiten
    // Tabellen steht das Wichtige oft rechts außerhalb. Nach oben gedeckelt,
    // damit kein unhandliches Riesenbild entsteht.
    const inhaltsbreite = Math.max(
      window.innerWidth,
      document.documentElement.scrollWidth || 0,
      document.body.scrollWidth || 0,
    );
    const breite = Math.min(inhaltsbreite, 2600);
    const hoehe = window.innerHeight;

    // Fest stehende Teile (Seitenleiste, Kopfzeile) kennzeichnen: Sie
    // dürfen die Verschiebung unten NICHT mitmachen, sonst rutschen sie
    // beim gescrollten Bild aus dem Bild heraus.
    const fest: HTMLElement[] = [];
    if (window.scrollY > 0) {
      document.querySelectorAll<HTMLElement>("*").forEach((el) => {
        if (getComputedStyle(el).position === "fixed") {
          el.dataset.bildschirmfotoFest = "1";
          fest.push(el);
        }
      });
    }

    try {
      return await domToJpeg(document.body, {
      // Ausschnitt: waagrecht alles, senkrecht das, was der Mensch sieht.
      width: breite,
      height: hoehe,
      // Der Body beginnt oben links; gescrollt wird über die Verschiebung.
      style: {
        transform: `translateY(-${window.scrollY}px)`,
        transformOrigin: "top left",
      },
      // …und die festen Teile um denselben Betrag zurückschieben, damit sie
      // dort stehen, wo sie am Schirm stehen.
      onCloneNode: (geklont: Node) => {
        const wurzel = geklont as HTMLElement;
        if (!window.scrollY || !wurzel?.querySelectorAll) return;
        wurzel.querySelectorAll<HTMLElement>("[data-bildschirmfoto-fest]").forEach((el) => {
          el.style.transform = `translateY(${window.scrollY}px)`;
        });
      },
      quality: 0.85,
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
      // Große Schirme nicht auch noch verdoppeln — die Datei soll
      // verschickbar bleiben.
      scale: breite > 1600 ? 1 : Math.min(2, window.devicePixelRatio || 1),
      filter: (knoten: Node) => {
        const el = knoten as Element;
        return !(el?.matches?.(AUSBLENDEN) ?? false);
      },
      });
    } finally {
      fest.forEach((el) => { delete el.dataset.bildschirmfotoFest; });
    }
  } catch (fehler) {
    // Ein fehlgeschlagenes Bild darf die Meldung nicht verhindern.
    console.warn("Bildschirmfoto nicht möglich:", fehler);
    return null;
  }
}

/** Data-URL zu Blob, für den Upload. */
export function datenUrlZuBlob(datenUrl: string): Blob {
  const [kopf, inhalt] = datenUrl.split(",");
  const mime = kopf.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
  const roh = atob(inhalt);
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
