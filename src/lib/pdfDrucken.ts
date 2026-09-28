// PDF direkt drucken — ein Tipp, und der Druckdialog ist da.
//
// Warum nicht einfach iframe.print()? Am iPhone druckt das nur die erste Seite,
// Android-Chrome zeigt PDFs gar nicht im iframe. Deshalb: Seiten mit pdf.js in
// Bilder umwandeln, kurz in die Seite hängen und window.print() — das geht überall.
// pdf.js (Legacy-Build 3.x, läuft auch auf älteren iPhones) wird erst beim ersten
// Drucken geladen, die App bleibt dadurch schlank.

const BEREICH_ID = "pdf-druckbereich";

export async function pdfDrucken(pdf: Blob | string): Promise<void> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.js?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const daten = typeof pdf === "string" ? await (await fetch(pdf)).arrayBuffer() : await pdf.arrayBuffer();
  const dok = await pdfjs.getDocument({ data: new Uint8Array(daten) }).promise;

  // Seiten als Bilder (Faktor 2 ≈ 150 dpi — scharf genug für Text, nicht zu groß)
  const bilder: string[] = [];
  for (let n = 1; n <= dok.numPages; n++) {
    const seite = await dok.getPage(n);
    const ansicht = seite.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(ansicht.width);
    canvas.height = Math.floor(ansicht.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await seite.render({ canvasContext: ctx, viewport: ansicht }).promise;
    bilder.push(canvas.toDataURL("image/png"));
  }
  await dok.destroy();

  document.getElementById(BEREICH_ID)?.remove();
  const bereich = document.createElement("div");
  bereich.id = BEREICH_ID;
  bereich.innerHTML = `
    <style>
      #${BEREICH_ID} { display: none; }
      @media print {
        @page { size: A4; margin: 0; }
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; }
        body > *:not(#${BEREICH_ID}) { display: none !important; }
        #${BEREICH_ID} { display: block !important; }
        #${BEREICH_ID} img { display: block; width: 210mm; height: 297mm; object-fit: contain; page-break-after: always; break-after: page; }
        #${BEREICH_ID} img:last-child { page-break-after: auto; break-after: auto; }
      }
    </style>`;
  for (const src of bilder) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    bereich.appendChild(img);
  }
  document.body.appendChild(bereich);

  // Warten, bis die Bilder wirklich da sind — sonst druckt Safari leere Seiten
  await Promise.all(Array.from(bereich.querySelectorAll("img")).map((img) =>
    img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })));

  const aufraeumen = () => { bereich.remove(); window.removeEventListener("afterprint", aufraeumen); };
  window.addEventListener("afterprint", aufraeumen);
  window.print();
  // Manche Browser melden afterprint nicht zuverlässig — spätestens nach 1 Minute weg
  window.setTimeout(aufraeumen, 60_000);
}
