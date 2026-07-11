import { Resend } from "https://esm.sh/resend@2.0.0";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// Supabase Admin Client for reading settings
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Material {
  id: string;
  material: string;
  menge: string | null;
  notizen: string | null;
}

interface Photo {
  id: string;
  file_path: string;
  file_name: string;
}

interface Disturbance {
  id: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  stunden: number;
  kunde_name: string;
  kunde_email: string | null;
  kunde_adresse: string | null;
  kunde_telefon: string | null;
  beschreibung: string;
  notizen: string | null;
  unterschrift_kunde: string;
}

interface ReportRequest {
  disturbance: Disturbance;
  materials: Material[];
  technicianNames?: string[];
  technicianName?: string; // Legacy support
  photos?: Photo[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("Failed to fetch image:", url, response.status);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error("Error fetching image:", error);
    return null;
  }
}

async function generatePDF(data: ReportRequest & { technicians: string[] }, photoImages: (string | null)[]): Promise<string> {
  const { disturbance, materials, technicians, photos } = data;
  
  // Create PDF document
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;
  let yPos = margin;

  // Fetch and add company logo (public branding bucket of this project)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  let logoLoaded = false;
  try {
    const logoResponse = await fetch(`${supabaseUrl}/storage/v1/object/public/branding/ruff-logo.png`);
    if (logoResponse.ok) {
      const logoBuffer = await logoResponse.arrayBuffer();
      const logoUint8 = new Uint8Array(logoBuffer);
      let logoBinary = "";
      for (let i = 0; i < logoUint8.length; i++) {
        logoBinary += String.fromCharCode(logoUint8[i]);
      }
      const logoBase64 = `data:image/png;base64,${btoa(logoBinary)}`;
      doc.addImage(logoBase64, "PNG", margin, yPos, 30, 19);
      logoLoaded = true;
    }
  } catch (e) {
    console.error("Could not load logo:", e);
  }

  // Company name next to logo (or standalone)
  if (logoLoaded) {
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(240, 112, 2);
    doc.text("Ruff Michael GmbH", margin + 35, yPos + 12);
    yPos += 24;
  } else {
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(240, 112, 2);
    doc.text("Ruff Michael GmbH", margin, yPos);
    yPos += 8;
  }

  // Divider line
  doc.setDrawColor(240, 112, 2);
  doc.setLineWidth(0.5);
  doc.line(margin, yPos, margin + contentWidth, yPos);
  yPos += 5;

  // Subtitle
  doc.setFontSize(16);
  doc.setTextColor(100, 100, 100);
  doc.text("Regiebericht", margin, yPos);
  yPos += 12;

  // Reset text color
  doc.setTextColor(0, 0, 0);

  // Customer Information Section
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Kundendaten", margin, yPos);
  yPos += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  
  doc.text(`Name: ${disturbance.kunde_name}`, margin, yPos);
  yPos += 5;

  if (disturbance.kunde_adresse) {
    doc.text(`Adresse: ${disturbance.kunde_adresse}`, margin, yPos);
    yPos += 5;
  }

  if (disturbance.kunde_telefon) {
    doc.text(`Telefon: ${disturbance.kunde_telefon}`, margin, yPos);
    yPos += 5;
  }

  if (disturbance.kunde_email) {
    doc.text(`E-Mail: ${disturbance.kunde_email}`, margin, yPos);
    yPos += 5;
  }

  yPos += 10;

  // Work Information Section
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Einsatzdaten", margin, yPos);
  yPos += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  doc.text(`Datum: ${formatDate(disturbance.datum)}`, margin, yPos);
  yPos += 5;

  const startTime = disturbance.start_time.slice(0, 5);
  const endTime = disturbance.end_time.slice(0, 5);
  doc.text(`Arbeitszeit: ${startTime} - ${endTime} Uhr`, margin, yPos);
  yPos += 5;

  if (disturbance.pause_minutes > 0) {
    doc.text(`Pause: ${disturbance.pause_minutes} Minuten`, margin, yPos);
    yPos += 5;
  }

  doc.setFont("helvetica", "bold");
  doc.text(`Gesamtstunden: ${disturbance.stunden.toFixed(2)} Stunden`, margin, yPos);
  doc.setFont("helvetica", "normal");
  yPos += 5;

  // Display technicians
  if (technicians.length === 1) {
    doc.text(`Techniker: ${technicians[0]}`, margin, yPos);
    yPos += 5;
  } else if (technicians.length > 1) {
    doc.text("Techniker:", margin, yPos);
    yPos += 5;
    technicians.forEach((name) => {
      doc.text(`  - ${name}`, margin, yPos);
      yPos += 5;
    });
  }
  yPos += 7;

  // Work Description Section
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Durchgeführte Arbeiten", margin, yPos);
  yPos += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  // Split long text into lines
  const beschreibungLines = doc.splitTextToSize(disturbance.beschreibung, contentWidth);
  doc.text(beschreibungLines, margin, yPos);
  yPos += beschreibungLines.length * 5 + 5;

  // Notes Section (if present)
  if (disturbance.notizen) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Notizen", margin, yPos);
    yPos += 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const notizenLines = doc.splitTextToSize(disturbance.notizen, contentWidth);
    doc.text(notizenLines, margin, yPos);
    yPos += notizenLines.length * 5 + 5;
  }

  yPos += 5;

  // Materials Section (if present)
  if (materials && materials.length > 0) {
    // Check if we need a new page
    if (yPos > 220) {
      doc.addPage();
      yPos = margin;
    }

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Verwendetes Material", margin, yPos);
    yPos += 7;

    // Table header
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos - 4, contentWidth, 7, "F");
    doc.text("Material", margin + 2, yPos);
    doc.text("Menge", margin + 90, yPos);
    doc.text("Notizen", margin + 120, yPos);
    yPos += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    materials.forEach((mat) => {
      if (yPos > 270) {
        doc.addPage();
        yPos = margin;
      }
      
      // Draw row border
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, yPos + 2, margin + contentWidth, yPos + 2);
      
      doc.text(mat.material || "-", margin + 2, yPos);
      doc.text(mat.menge || "-", margin + 90, yPos);
      doc.text(mat.notizen || "-", margin + 120, yPos);
      yPos += 7;
    });

    yPos += 8;
  }

  // Photos Section (if present)
  if (photos && photos.length > 0 && photoImages.some(img => img !== null)) {
    // Start new page for photos
    doc.addPage();
    yPos = margin;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Fotos", margin, yPos);
    yPos += 10;

    for (let i = 0; i < photos.length; i++) {
      const imageData = photoImages[i];
      if (!imageData) continue;

      // Check if we need a new page
      if (yPos > 200) {
        doc.addPage();
        yPos = margin;
      }

      try {
        // Add image with max width 80mm, proportional height ~60mm
        doc.addImage(imageData, "JPEG", margin, yPos, 80, 60);
        yPos += 65;

        // Add filename below image
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(photos[i].file_name, margin, yPos);
        yPos += 8;
        doc.setTextColor(0, 0, 0);
      } catch (e) {
        console.error("Error adding image to PDF:", e);
      }
    }
  }

  // Signature Section
  // Check if we need a new page for signature
  if (yPos > 200) {
    doc.addPage();
    yPos = margin;
  }

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Kundenunterschrift", margin, yPos);
  yPos += 5;

  // Add signature image if present
  if (disturbance.unterschrift_kunde) {
    try {
      // The signature is a base64 data URL
      const signatureData = disturbance.unterschrift_kunde;
      
      // Add the signature image
      doc.addImage(signatureData, "PNG", margin, yPos, 60, 25);
      yPos += 30;
    } catch (e) {
      console.error("Error adding signature:", e);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.text("[Unterschrift konnte nicht geladen werden]", margin, yPos + 10);
      yPos += 20;
    }
  }

  // Confirmation text
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  const confirmText = "Der Kunde bestätigt mit seiner Unterschrift die ordnungsgemäße Durchführung der oben genannten Arbeiten.";
  const confirmLines = doc.splitTextToSize(confirmText, contentWidth);
  doc.text(confirmLines, margin, yPos);
  yPos += 15;

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  const footerY = doc.internal.pageSize.getHeight() - 15;
  doc.text(`Erstellt am: ${new Date().toLocaleDateString("de-AT")} | Ruff Michael GmbH`, margin, footerY);

  // Return as base64
  return doc.output("datauristring").split(",")[1];
}

function generateEmailHtml(data: ReportRequest & { technicians: string[] }): string {
  const { disturbance, technicians } = data;
  const technicianDisplay = technicians.length === 1 ? technicians[0] : technicians.join(", ");
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #333; line-height: 1.5; }
        .header { color: #F07002; font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .info-box { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">Ruff Michael GmbH</div>
        <h2>Regiebericht</h2>
        
        <p>Sehr geehrte Damen und Herren,</p>
        
        <p>im Anhang finden Sie den Regiebericht für den Einsatz bei <strong>${disturbance.kunde_name}</strong> vom <strong>${formatDate(disturbance.datum)}</strong>.</p>
        
        <div class="info-box">
          <strong>Zusammenfassung:</strong><br>
          Techniker: ${technicianDisplay}<br>
          Arbeitszeit: ${disturbance.start_time.slice(0, 5)} - ${disturbance.end_time.slice(0, 5)} Uhr<br>
          Gesamtstunden: ${disturbance.stunden.toFixed(2)} h
        </div>
        
        <p>Der vollständige Bericht mit allen Details und der Kundenunterschrift befindet sich im angehängten PDF-Dokument.</p>
        
        <p>Mit freundlichen Grüßen,<br>
        Ruff Michael GmbH – Wärme, Kälte, Regelung</p>
      </div>
    </body>
    </html>
  `;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { disturbance, materials, technicianNames, technicianName, photos }: ReportRequest = await req.json();

    // Backward compatibility + fallback
    const technicians = technicianNames?.length ? technicianNames : 
                        technicianName ? [technicianName] : ["Techniker"];

    if (!disturbance || !disturbance.unterschrift_kunde) {
      return new Response(
        JSON.stringify({ error: "Disturbance data and signature required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Generating PDF for disturbance:", disturbance.id);

    // Fetch photo images from storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const photoImages: (string | null)[] = [];
    if (photos && photos.length > 0) {
      console.log(`Fetching ${photos.length} photos...`);
      for (const photo of photos) {
        const photoUrl = `${supabaseUrl}/storage/v1/object/public/disturbance-photos/${photo.file_path}`;
        const imageData = await fetchImageAsBase64(photoUrl);
        photoImages.push(imageData);
      }
    }

    // Generate PDF
    const pdfBase64 = await generatePDF({ disturbance, materials, technicians, photos }, photoImages);

    // Generate simple email HTML
    const emailHtml = generateEmailHtml({ disturbance, materials, technicians });

    // Fetch office email from settings with fallback
    const { data: setting } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "disturbance_report_email")
      .maybeSingle();

    const officeEmail = setting?.value || "hallo@epowergmbh.at";
    console.log("Using office email:", officeEmail);

    // Prepare recipients - office email for all reports
    const recipients = [officeEmail];
    if (disturbance.kunde_email) {
      recipients.push(disturbance.kunde_email);
    }

    // Create filename
    const dateForFilename = formatDateShort(disturbance.datum).replace(/\./g, "-");
    const kundeForFilename = disturbance.kunde_name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "_");
    const pdfFilename = `Regiebericht_${kundeForFilename}_${dateForFilename}.pdf`;

    const subject = `Regiebericht - ${disturbance.kunde_name} - ${formatDateShort(disturbance.datum)}`;

    console.log("Sending email with PDF attachment to:", recipients);

    const fromAddress = Deno.env.get("REPORT_FROM_EMAIL") || "Ruff Michael GmbH <noreply@chrisnapetschnig.at>";
    const emailResponse = await resend.emails.send({
      from: fromAddress,
      to: recipients,
      subject: subject,
      html: emailHtml,
      attachments: [
        {
          filename: pdfFilename,
          content: pdfBase64,
        },
      ],
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailResponse }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error sending disturbance report:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
