/**
 * Letter PDF Renderer
 *
 * Reusable PDF generator for AI-drafted letters (PA requests, credentialing
 * packet covers, credentialing application covers). Replaces the "download
 * as .txt" path with a properly typeset 1-page document the biller can
 * fax / email / print directly.
 *
 * Designed for letterhead-style output: practice info at the top, date,
 * recipient, body, signature block. Optional appended sections (e.g. a
 * document checklist for credentialing packets, a Q&A list for credentialing
 * applications).
 */

import PDFDocument from 'pdfkit';

export interface LetterPdfInput {
  /** Practice info shown as letterhead at the top of the page. */
  practice: {
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    npi?: string | null;
  };
  /** Recipient — typically the payer's enrollment / PA review department. */
  recipient?: {
    line1?: string;
    line2?: string;
  };
  /** Subject / Re: line (optional). */
  subject?: string;
  /** Main letter body — the AI-generated text. Newlines preserved. */
  body: string;
  /** Optional additional sections rendered after the body, in order. */
  sections?: Array<
    | { type: 'checklist'; title: string; items: Array<{ item: string; description: string; alreadyOnFile?: boolean }> }
    | { type: 'qa'; title: string; entries: Array<{ question: string; answer: string }> }
    | { type: 'text'; title: string; text: string }
  >;
}

/**
 * Render a letter to a PDF buffer. Caller pipes into res.send() or stream.
 * Returns a Promise<Buffer> instead of streaming for simpler error handling
 * — these letters are tiny (~5-10KB), no memory concern.
 */
export async function renderLetterPdf(input: LetterPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      info: {
        Title: input.subject || 'Letter',
        Author: input.practice.name,
        Producer: 'TherapyBill AI',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ─── Letterhead ──────────────────────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').text(input.practice.name, { align: 'left' });
    doc.fontSize(9).font('Helvetica').fillColor('#475569');
    const headerLines: string[] = [];
    if (input.practice.address) headerLines.push(input.practice.address);
    const contactLine = [input.practice.phone, input.practice.email].filter(Boolean).join(' · ');
    if (contactLine) headerLines.push(contactLine);
    if (input.practice.npi) headerLines.push(`NPI: ${input.practice.npi}`);
    for (const line of headerLines) doc.text(line);
    doc.moveDown(0.5);
    doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(60, doc.y).lineTo(552, doc.y).stroke();
    doc.moveDown(1);
    doc.fillColor('#0f172a');

    // ─── Date + recipient ────────────────────────────────────────
    doc.fontSize(10).font('Helvetica');
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.text(today);
    doc.moveDown(0.8);

    if (input.recipient?.line1) {
      doc.text(input.recipient.line1);
      if (input.recipient.line2) doc.text(input.recipient.line2);
      doc.moveDown(0.8);
    }

    // ─── Subject ─────────────────────────────────────────────────
    if (input.subject) {
      doc.font('Helvetica-Bold').text(`Re: ${input.subject}`);
      doc.moveDown(0.6);
      doc.font('Helvetica');
    }

    // ─── Body ────────────────────────────────────────────────────
    // PDFKit handles word wrap automatically. Preserve paragraph breaks
    // (double newline → bigger gap, single newline → flow).
    const paragraphs = input.body.split(/\n\s*\n/);
    for (let i = 0; i < paragraphs.length; i++) {
      doc.fontSize(10.5).text(paragraphs[i].trim(), { align: 'left', lineGap: 2 });
      if (i < paragraphs.length - 1) doc.moveDown(0.6);
    }

    // ─── Optional appended sections ──────────────────────────────
    if (input.sections && input.sections.length > 0) {
      for (const section of input.sections) {
        doc.moveDown(1);
        doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(60, doc.y).lineTo(552, doc.y).stroke();
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica-Bold').text(section.title);
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica');

        if (section.type === 'checklist') {
          for (const item of section.items) {
            const box = item.alreadyOnFile ? '[x]' : '[ ]';
            doc.font('Courier').text(box, { continued: true });
            doc.font('Helvetica-Bold').text(' ' + item.item);
            doc.font('Helvetica').fontSize(9).fillColor('#64748b');
            doc.text(item.description, { indent: 18 });
            doc.fillColor('#0f172a').fontSize(10);
            doc.moveDown(0.3);
          }
        } else if (section.type === 'qa') {
          for (const entry of section.entries) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text(entry.question);
            doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(entry.answer);
            doc.moveDown(0.4);
          }
        } else if (section.type === 'text') {
          doc.text(section.text);
        }
      }
    }

    // ─── Footer ──────────────────────────────────────────────────
    doc.fontSize(8).fillColor('#94a3b8');
    const bottomY = doc.page.height - 50;
    doc.text(`Generated by TherapyBill AI · ${today}`, 60, bottomY, {
      align: 'center',
      width: 492,
    });

    doc.end();
  });
}
