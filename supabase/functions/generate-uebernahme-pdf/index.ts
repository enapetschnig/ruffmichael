import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Supabase Admin Client (service role) for DB access + storage upload
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Uebernahme {
  id: string;
  project_id: string;
  kunde_name: string;
  strasse: string | null;
  plz_ort: string | null;
  auftrag_nr: string | null;
  zusatz_leistungen: string | null;
  leistungsverzeichnis: string | null;
  bedienungsanleitung: boolean;
  ort: string | null;
  datum: string;
  unterschrift: string | null;
  pdf_path: string | null;
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

async function fetchLogoAsBase64(): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/public/branding/ruff-logo.png`
    );
    if (!response.ok) {
      console.error("Failed to fetch logo:", response.status);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return `data:image/png;base64,${btoa(binary)}`;
  } catch (error) {
    console.error("Error fetching logo:", error);
    return null;
  }
}

/**
 * Draws optional text distributed over a fixed number of horizontal
 * form lines (like the ruled lines on the paper form). If the text
 * needs more rows than lineCount, extra rows (with lines) are added.
 * Returns the y position below the last line.
 */
function drawTextOnFormLines(
  // deno-lint-ignore no-explicit-any
  doc: any,
  text: string | null,
  x: number,
  y: number,
  width: number,
  lineCount: number
): number {
  const rowHeight = 8;
  const textLines: string[] = text
    ? doc.splitTextToSize(text, width)
    : [];
  const rows = Math.max(lineCount, textLines.length);

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);

  let yPos = y;
  for (let i = 0; i < rows; i++) {
    if (textLines[i]) {
      doc.text(textLines[i], x, yPos + 6);
    }
    // Underline just below the text baseline
    doc.line(x, yPos + 7.5, x + width, yPos + 7.5);
    yPos += rowHeight;
  }
  return yPos;
}

function generatePDF(uebernahme: Uebernahme, logoBase64: string | null): ArrayBuffer {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;
  const rightEdge = pageWidth - margin;

  // ------------------------------------------------------------------
  // 1. Header: logo top-left, contact block on the right
  // ------------------------------------------------------------------
  if (logoBase64) {
    try {
      // Keep the logo's ~1.5 aspect ratio
      doc.addImage(logoBase64, "PNG", margin, margin, 52, 34);
    } catch (e) {
      console.error("Error adding logo to PDF:", e);
    }
  } else {
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(240, 112, 2);
    doc.text("Ruff Michael GmbH", margin, margin + 12);
    doc.setTextColor(0, 0, 0);
  }

  // Right header block: two colored bars with white bold text
  const blockX = 115;
  const blockWidth = rightEdge - blockX;
  const barHeight = 9;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);

  // "HEIZUNGS- &" on orange bar
  doc.setFillColor(240, 112, 2); // #F07002
  doc.rect(blockX, margin, blockWidth, barHeight, "F");
  doc.setTextColor(255, 255, 255);
  doc.text("HEIZUNGS- &", rightEdge - 2, margin + 6.5, { align: "right" });

  // "KLIMATECHNIK" on grey bar
  doc.setFillColor(107, 114, 128); // #6B7280
  doc.rect(blockX, margin + barHeight + 1, blockWidth, barHeight, "F");
  doc.text("KLIMATECHNIK", rightEdge - 2, margin + barHeight + 7.5, { align: "right" });

  // Contact lines below the bars (right-aligned, black)
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("www.ruffinstallateur.at", rightEdge, margin + 27, { align: "right" });
  doc.setFontSize(13);
  doc.text("0699/143 307 08", rightEdge, margin + 34, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("office@ruffinstallateur.at", rightEdge, margin + 41, { align: "right" });

  // ------------------------------------------------------------------
  // 2. Customer block
  // ------------------------------------------------------------------
  let yPos = 75;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Kunden Name : ${uebernahme.kunde_name || ""}`, margin, yPos);
  yPos += 8;
  doc.text(`Straße: ${uebernahme.strasse || ""}`, margin, yPos);
  yPos += 8;
  doc.text(`PLZ Ort : ${uebernahme.plz_ort || ""}`, margin, yPos);
  yPos += 12;

  // ------------------------------------------------------------------
  // 3. Title
  // ------------------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Übernahmebestätigung", margin, yPos);
  yPos += 10;

  // ------------------------------------------------------------------
  // 4. Auftragsbestätigungs-Nr.
  // ------------------------------------------------------------------
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const auftragNr = uebernahme.auftrag_nr?.trim() || "______";
  doc.text(`Die Ruff Auftragsbestätigung Nr. ${auftragNr}`, margin, yPos);
  yPos += 8;

  // ------------------------------------------------------------------
  // 5. Handover paragraph
  // ------------------------------------------------------------------
  const paragraph =
    "Wurde mir/uns heute , nach sachgemäßer und ohne Beanstandung durchgeführter " +
    "Montage in einwandfreiem Zustand übergeben . Die Anlage bleibt bis vollständige " +
    "Bezahlung des Kaufpreises Eigentum der Ruff Michael GmbH";
  const paragraphLines = doc.splitTextToSize(paragraph, contentWidth);
  doc.text(paragraphLines, margin, yPos);
  yPos += paragraphLines.length * 5.5 + 7;

  // ------------------------------------------------------------------
  // 6. Zusätzlich aufgewendete Leistungen (2 form lines)
  // ------------------------------------------------------------------
  doc.text("*) Zusätzlich aufgewendete Leistungen :", margin, yPos);
  yPos = drawTextOnFormLines(
    doc,
    uebernahme.zusatz_leistungen,
    margin,
    yPos + 1,
    contentWidth,
    2
  );
  yPos += 6;

  // ------------------------------------------------------------------
  // 7. Leistungsverzeichnis bei Regiemontagen (3 form lines)
  // ------------------------------------------------------------------
  doc.text("*) Leistungsverzeichnis bei Regiemontagen :", margin, yPos);
  yPos = drawTextOnFormLines(
    doc,
    uebernahme.leistungsverzeichnis,
    margin,
    yPos + 1,
    contentWidth,
    3
  );
  yPos += 6;

  // ------------------------------------------------------------------
  // 8. Bedienungsanleitung (1 form line)
  // ------------------------------------------------------------------
  const anleitungText = uebernahme.bedienungsanleitung
    ? "*) Anbei Bedienungsanleitung   JA - übergeben"
    : "*) Anbei Bedienungsanleitung";
  doc.text(anleitungText, margin, yPos);
  yPos = drawTextOnFormLines(doc, null, margin, yPos + 1, contentWidth, 1);
  yPos += 8;

  // ------------------------------------------------------------------
  // 9. Ort / Datum
  // ------------------------------------------------------------------
  const datumFormatted = formatDateShort(uebernahme.datum);
  const ortX = margin;
  const datumX = margin + 60;
  const shortLineWidth = 40;

  doc.text("Ort", ortX, yPos);
  doc.text("Datum", datumX, yPos);
  yPos += 9;

  doc.text(uebernahme.ort || "", ortX, yPos);
  doc.text(datumFormatted, datumX, yPos);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(ortX, yPos + 1.5, ortX + shortLineWidth, yPos + 1.5);
  doc.line(datumX, yPos + 1.5, datumX + shortLineWidth, yPos + 1.5);
  yPos += 10;

  // ------------------------------------------------------------------
  // 10. Signature block
  // ------------------------------------------------------------------
  // Make sure the whole signature block fits on the page
  const signatureBlockHeight = uebernahme.unterschrift ? 45 : 17;
  if (yPos + signatureBlockHeight > pageHeight - margin) {
    doc.addPage();
    yPos = margin;
  }

  if (uebernahme.unterschrift) {
    try {
      doc.addImage(uebernahme.unterschrift, "PNG", margin, yPos, 70, 28);
      yPos += 30;
    } catch (e) {
      console.error("Error adding signature to PDF:", e);
      yPos += 5;
    }
  }

  doc.setFontSize(11);
  doc.text("...........................................", margin, yPos);
  yPos += 6;
  doc.text("Unterschrift und Firmenstempel des Auftraggeber", margin, yPos);
  yPos += 6;
  doc.text("Oder dessen Beauftragten", margin + 15, yPos);

  return doc.output("arraybuffer");
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { uebernahmeId } = await req.json();

    if (!uebernahmeId) {
      return new Response(
        JSON.stringify({ error: "uebernahmeId required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Load the Übernahme row
    const { data: uebernahme, error: loadError } = await supabaseAdmin
      .from("uebernahmen")
      .select(
        "id, project_id, kunde_name, strasse, plz_ort, auftrag_nr, zusatz_leistungen, leistungsverzeichnis, bedienungsanleitung, ort, datum, unterschrift, pdf_path"
      )
      .eq("id", uebernahmeId)
      .maybeSingle();

    if (loadError) {
      console.error("Error loading uebernahme:", loadError);
      return new Response(
        JSON.stringify({ error: loadError.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!uebernahme) {
      return new Response(
        JSON.stringify({ error: "Übernahme not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Generating Übernahmebestätigung PDF for:", uebernahme.id);

    // Fetch logo and generate PDF
    const logoBase64 = await fetchLogoAsBase64();
    const pdfArrayBuffer = generatePDF(uebernahme as Uebernahme, logoBase64);

    // Build storage path: {project_id}/Abnahme Protokoll/Uebernahmebestaetigung_{kunde}_{datum}.pdf
    const kundeSafe = (uebernahme.kunde_name || "Kunde").replace(
      /[^a-zA-Z0-9äöüÄÖÜß_-]/g,
      "_"
    );
    const datumSafe = formatDateShort(uebernahme.datum).replace(/\./g, "-");
    const path = `${uebernahme.project_id}/Abnahme Protokoll/Uebernahmebestaetigung_${kundeSafe}_${datumSafe}.pdf`;

    // Upload PDF to the project files bucket
    const { error: uploadError } = await supabaseAdmin.storage
      .from("project-files")
      .upload(path, new Blob([pdfArrayBuffer], { type: "application/pdf" }), {
        upsert: true,
        contentType: "application/pdf",
      });

    if (uploadError) {
      console.error("Error uploading PDF:", uploadError);
      return new Response(
        JSON.stringify({ error: `Upload failed: ${uploadError.message}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Store the path on the row
    const { error: updateError } = await supabaseAdmin
      .from("uebernahmen")
      .update({ pdf_path: path })
      .eq("id", uebernahme.id);

    if (updateError) {
      console.error("Error updating pdf_path:", updateError);
      return new Response(
        JSON.stringify({ error: `Update failed: ${updateError.message}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Signed URL so the client can open the PDF right away
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from("project-files")
      .createSignedUrl(path, 3600);

    if (signError) {
      console.error("Error creating signed URL:", signError);
      return new Response(
        JSON.stringify({ error: `Signed URL failed: ${signError.message}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("PDF uploaded to:", path);

    return new Response(
      JSON.stringify({ success: true, path, signedUrl: signed.signedUrl }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error generating Übernahme PDF:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
