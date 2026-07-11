import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { invoiceId } = await req.json();

    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch invoice
    const { data: invoice, error: invError } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (invError || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch items
    const { data: items } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("position");

    const typLabel = invoice.typ === "rechnung" ? "RECHNUNG" : "ANGEBOT";
    const datumFormatted = new Date(invoice.datum).toLocaleDateString("de-AT");
    const faelligFormatted = invoice.faellig_am ? new Date(invoice.faellig_am).toLocaleDateString("de-AT") : null;
    const leistungFormatted = invoice.leistungsdatum ? new Date(invoice.leistungsdatum).toLocaleDateString("de-AT") : null;

    // Build HTML for PDF
    const itemRows = (items || []).map((item: any) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.position}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.beschreibung}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.menge).toFixed(2)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.einheit || 'Stk.'}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">€ ${Number(item.einzelpreis).toFixed(2)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">€ ${Number(item.gesamtpreis).toFixed(2)}</td>
      </tr>
    `).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #1a1a1a; margin: 0; padding: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
  .company { font-size: 14pt; font-weight: 700; color: #F07002; }
  .company-details { font-size: 8pt; color: #666; margin-top: 4px; }
  .doc-type { font-size: 20pt; font-weight: 700; color: #333; text-align: right; }
  .doc-number { font-size: 11pt; color: #666; text-align: right; }
  .customer-box { background: #f8f9fa; padding: 16px; border-radius: 6px; margin-bottom: 24px; }
  .customer-label { font-size: 8pt; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
  .meta-item { font-size: 9pt; }
  .meta-label { color: #999; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #f1f5f9; padding: 10px 8px; text-align: left; font-weight: 600; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; border-bottom: 2px solid #cbd5e1; }
  .totals { margin-left: auto; width: 280px; }
  .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 10pt; }
  .total-row.grand { border-top: 2px solid #333; font-size: 13pt; font-weight: 700; padding-top: 10px; margin-top: 6px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 8pt; color: #999; text-align: center; }
  .notes { background: #fffbeb; padding: 12px; border-radius: 4px; margin-top: 20px; font-size: 9pt; border-left: 3px solid #f59e0b; }
</style>
</head><body>

<div class="header">
  <div>
     <div class="company">Ruff Michael GmbH</div>
    <div class="company-details">
      Installateur – Wärme, Kälte, Regelung
    </div>
  </div>
  <div>
    <div class="doc-type">${typLabel}</div>
    <div class="doc-number">${invoice.nummer}</div>
  </div>
</div>

<div class="customer-box">
  <div class="customer-label">Kunde</div>
  <strong>${invoice.kunde_name}</strong><br>
  ${invoice.kunde_adresse ? invoice.kunde_adresse + '<br>' : ''}
  ${invoice.kunde_plz || ''} ${invoice.kunde_ort || ''}<br>
  ${invoice.kunde_land || ''}
  ${invoice.kunde_uid ? '<br>UID: ' + invoice.kunde_uid : ''}
</div>

<div class="meta-grid">
  <div class="meta-item"><span class="meta-label">Datum:</span> ${datumFormatted}</div>
  ${leistungFormatted ? `<div class="meta-item"><span class="meta-label">Leistungsdatum:</span> ${leistungFormatted}</div>` : ''}
  ${faelligFormatted ? `<div class="meta-item"><span class="meta-label">Fällig am:</span> ${faelligFormatted}</div>` : ''}
  ${invoice.zahlungsbedingungen ? `<div class="meta-item"><span class="meta-label">Zahlungsbedingungen:</span> ${invoice.zahlungsbedingungen}</div>` : ''}
</div>

<table>
  <thead>
    <tr>
      <th style="width:40px;text-align:center;">Pos.</th>
      <th>Beschreibung</th>
      <th style="width:60px;text-align:right;">Menge</th>
      <th style="width:50px;text-align:center;">Einheit</th>
      <th style="width:90px;text-align:right;">Einzelpreis</th>
      <th style="width:90px;text-align:right;">Gesamt</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
</table>

<div class="totals">
  <div class="total-row"><span>Netto</span><span>€ ${Number(invoice.netto_summe).toFixed(2)}</span></div>
  <div class="total-row"><span>MwSt (${Number(invoice.mwst_satz).toFixed(0)}%)</span><span>€ ${Number(invoice.mwst_betrag).toFixed(2)}</span></div>
  <div class="total-row grand"><span>Brutto</span><span>€ ${Number(invoice.brutto_summe).toFixed(2)}</span></div>
</div>

${invoice.notizen ? `<div class="notes"><strong>Anmerkung:</strong> ${invoice.notizen}</div>` : ''}

<div class="footer">
  Ruff Michael GmbH – Installateur
</div>

</body></html>`;

    // Use jsPDF alternative: convert HTML to PDF via a simple approach
    // Since Deno doesn't have puppeteer, we'll return the HTML and let the client render it
    // Actually, let's use a lightweight approach: encode the HTML as a data URI and return it
    
    // For now, return HTML that the client can print as PDF
    const base64Html = btoa(unescape(encodeURIComponent(html)));

    return new Response(JSON.stringify({ pdf: base64Html, format: "html" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
