import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Versand über Michaels Microsoft-365-Postfach (wie Angebote/Rechnungen in der Function
// „outlook“): Absender office@ruffinstallateur.at, Kopie in „Gesendete Elemente“.
// Früher Resend — der Schlüssel dafür wurde nie gesetzt, darum ging nichts raus.
const GRAPH = "https://graph.microsoft.com/v1.0";

async function msToken(): Promise<string> {
  const tenant = Deno.env.get("MS_TENANT_ID"), clientId = Deno.env.get("MS_CLIENT_ID"), secret = Deno.env.get("MS_CLIENT_SECRET");
  if (!tenant || !clientId || !secret) throw new Error("Die Microsoft-Zugangsdaten fehlen (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET).");
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Microsoft-Anmeldung fehlgeschlagen: ${data.error_description || JSON.stringify(data)}`);
  return data.access_token;
}

async function graph<T>(tok: string, pfad: string, init?: RequestInit): Promise<T> {
  const kopf: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (init?.body) kopf["Content-Type"] = "application/json";
  const res = await fetch(pfad.startsWith("http") ? pfad : `${GRAPH}${pfad}`, { ...init, headers: kopf });
  if (res.status === 202 || res.status === 204) return {} as T;
  const text = await res.text();
  if (!res.ok) throw new Error(`Outlook ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) as T : {} as T;
}

function postfach(): string {
  const ziel = Deno.env.get("MS_MAIL_TARGET") || Deno.env.get("MS_DRIVE_TARGET") || "";
  if (!ziel.includes("@")) throw new Error("Kein Postfach eingestellt — MS_MAIL_TARGET muss eine E-Mail-Adresse sein.");
  return ziel;
}

/** Mail mit PDF über Outlook senden — große Anhänge (viele Fotos) stückweise hochladen. */
async function perOutlookSenden(opt: { an: string[]; cc: string[]; betreff: string; html: string; dateiname: string; pdfBase64: string }) {
  const tok = await msToken();
  const mb = encodeURIComponent(postfach());
  const empfaenger = (liste: string[]) => liste.map((a) => ({ emailAddress: { address: a } }));
  const bytes = Uint8Array.from(atob(opt.pdfBase64), (c) => c.charCodeAt(0));
  if (bytes.length < 3 * 1024 * 1024) {
    await graph(tok, `/users/${mb}/sendMail`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: opt.betreff, body: { contentType: "HTML", content: opt.html },
          toRecipients: empfaenger(opt.an), ccRecipients: empfaenger(opt.cc),
          attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: opt.dateiname, contentType: "application/pdf", contentBytes: opt.pdfBase64 }],
        },
        saveToSentItems: true,
      }),
    });
    return;
  }
  const entwurf = await graph<{ id: string }>(tok, `/users/${mb}/messages`, {
    method: "POST",
    body: JSON.stringify({ subject: opt.betreff, body: { contentType: "HTML", content: opt.html }, toRecipients: empfaenger(opt.an), ccRecipients: empfaenger(opt.cc) }),
  });
  const sitzung = await graph<{ uploadUrl: string }>(tok, `/users/${mb}/messages/${entwurf.id}/attachments/createUploadSession`, {
    method: "POST",
    body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: opt.dateiname, size: bytes.length, contentType: "application/pdf" } }),
  });
  const stueck = 4 * 1024 * 1024;
  for (let von = 0; von < bytes.length; von += stueck) {
    const bis = Math.min(von + stueck, bytes.length);
    const res = await fetch(sitzung.uploadUrl, {
      method: "PUT",
      headers: { "Content-Length": String(bis - von), "Content-Range": `bytes ${von}-${bis - 1}/${bytes.length}` },
      body: bytes.subarray(von, bis),
    });
    if (!res.ok) throw new Error(`PDF-Anhang: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  await graph(tok, `/users/${mb}/messages/${entwurf.id}/send`, { method: "POST" });
}

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
  unterschrift_kunde: string | null;
}

interface ReportRequest {
  disturbance: Disturbance;
  materials: Material[];
  technicianNames?: string[];
  technicianName?: string; // Legacy support
  photos?: Photo[];
  /** Nur das PDF zurückgeben (Drucken/Teilen in der App) — auch ohne Unterschrift, ohne Versand */
  nurPdf?: boolean;
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
  } else {
    // Noch nicht unterschrieben: leere Linie zum Unterschreiben auf Papier
    doc.setDrawColor(120, 120, 120);
    doc.line(margin, yPos + 20, margin + 80, yPos + 20);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text("Datum, Unterschrift Kunde", margin, yPos + 25);
    doc.setTextColor(0, 0, 0);
    yPos += 32;
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
    const { disturbance, materials, technicianNames, technicianName, photos, nurPdf }: ReportRequest = await req.json();

    // Backward compatibility + fallback
    const technicians = technicianNames?.length ? technicianNames : 
                        technicianName ? [technicianName] : ["Techniker"];

    if (!disturbance || (!nurPdf && !disturbance.unterschrift_kunde)) {
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

    // Nur Drucken/Teilen: PDF zurückgeben, nichts versenden, Status unverändert
    if (nurPdf) {
      return new Response(
        JSON.stringify({ pdf: pdfBase64 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate simple email HTML
    const emailHtml = generateEmailHtml({ disturbance, materials, technicians });

    // Empfänger: der Kunde; das Büro bekommt eine Kopie (Einstellung „Regiebericht
    // E-Mail-Empfänger“). Die Mail liegt außerdem in „Gesendete Elemente“ des Firmenpostfachs.
    const { data: setting } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "disturbance_report_email")
      .maybeSingle();
    const buero = String(setting?.value ?? "").trim();
    const absender = postfach().toLowerCase();
    const kunde = String(disturbance.kunde_email ?? "").trim();
    const an = kunde ? [kunde] : (buero ? [buero] : [absender]);
    const cc = kunde && buero && buero.toLowerCase() !== absender && buero.toLowerCase() !== kunde.toLowerCase() ? [buero] : [];

    const dateForFilename = formatDateShort(disturbance.datum).replace(/\./g, "-");
    const kundeForFilename = disturbance.kunde_name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "_");
    const pdfFilename = `Regiebericht_${kundeForFilename}_${dateForFilename}.pdf`;
    const subject = `Regiebericht - ${disturbance.kunde_name} - ${formatDateShort(disturbance.datum)}`;

    console.log("Sende Regiebericht über Outlook an:", an, "Kopie:", cc);
    await perOutlookSenden({ an, cc, betreff: subject, html: emailHtml, dateiname: pdfFilename, pdfBase64 });
    const emailResponse = { an, cc, von: absender };

    console.log("Email sent successfully:", emailResponse);

    // Status erst NACH bestätigtem Versand setzen (einzige Quelle der Wahrheit,
    // gilt online wie beim Offline-Sync).
    await supabaseAdmin.from("disturbances").update({ status: "gesendet", pdf_gesendet_am: new Date().toISOString() }).eq("id", disturbance.id);

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
