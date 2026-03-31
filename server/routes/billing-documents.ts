import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { storage } from '../storage';
import { db } from '../db';
import { appeals, claims, patients, practices } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

// Generate PDF for appeal letter
router.get('/appeal-letter/:appealId/pdf', isAuthenticated, async (req, res) => {
  try {
    const appealId = parseInt(req.params.appealId);
    if (isNaN(appealId)) {
      return res.status(400).json({ error: 'Invalid appeal ID' });
    }

    // Fetch appeal with related data
    const appeal = await db.query.appeals.findFirst({
      where: eq(appeals.id, appealId),
    });

    if (!appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    if (!appeal.appealLetter) {
      return res.status(404).json({ error: 'No appeal letter generated yet' });
    }

    // Fetch related claim
    const claim = await db.query.claims.findFirst({
      where: eq(claims.id, appeal.claimId),
    });

    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    // Fetch patient
    const patient = await db.query.patients.findFirst({
      where: eq(patients.id, claim.patientId),
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Fetch practice for letterhead
    const practice = await db.query.practices.findFirst({
      where: eq(practices.id, appeal.practiceId),
    });

    if (!practice) {
      return res.status(404).json({ error: 'Practice not found' });
    }

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="appeal-letter-${appealId}.pdf"`
    );

    // Create PDF document
    const doc = new PDFDocument({ margin: 72 });
    doc.pipe(res);

    // Practice letterhead
    doc.fontSize(16).font('Helvetica-Bold').text(practice.name, { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica');
    if (practice.address) {
      doc.text(practice.address, { align: 'center' });
    }

    const contactLine = [];
    if (practice.phone) contactLine.push(`Phone: ${practice.phone}`);
    if (practice.npi) contactLine.push(`NPI: ${practice.npi}`);
    if (contactLine.length > 0) {
      doc.text(contactLine.join(' | '), { align: 'center' });
    }

    doc.moveDown(2);

    // Date
    doc.fontSize(10).font('Helvetica');
    doc.text(new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }), { align: 'left' });
    doc.moveDown(2);

    // Subject line
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text(`Re: Appeal for Claim #${claim.claimNumber || claim.id}`, { align: 'left' });
    doc.text(`Patient: ${patient.firstName} ${patient.lastName}`, { align: 'left' });
    if (appeal.appealLevel) {
      doc.text(`Appeal Level: ${appeal.appealLevel}`, { align: 'left' });
    }
    doc.moveDown(1.5);

    // Appeal letter body
    doc.fontSize(11).font('Helvetica');
    const letterLines = appeal.appealLetter.split('\n');
    letterLines.forEach((line: string) => {
      doc.text(line, { align: 'left', lineGap: 2 });
    });

    doc.moveDown(2);

    // Professional footer
    doc.fontSize(10).font('Helvetica');
    doc.text('Sincerely,', { align: 'left' });
    doc.moveDown(1);
    doc.text(practice.name, { align: 'left' });
    if (practice.taxId) {
      doc.moveDown(0.5);
      doc.fontSize(9).text(`Tax ID: ${practice.taxId}`, { align: 'left' });
    }

    // Finalize PDF
    doc.end();

    logger.info('Generated appeal letter PDF', { appealId, practiceId: appeal.practiceId });
  } catch (error) {
    logger.error('Error generating appeal letter PDF', { error, appealId: req.params.appealId });
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Generate fax cover sheet
router.get('/fax-cover/:appealId', isAuthenticated, async (req, res) => {
  try {
    const appealId = parseInt(req.params.appealId);
    if (isNaN(appealId)) {
      return res.status(400).json({ error: 'Invalid appeal ID' });
    }

    // Fetch appeal with related data
    const appeal = await db.query.appeals.findFirst({
      where: eq(appeals.id, appealId),
    });

    if (!appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    // Fetch related claim
    const claim = await db.query.claims.findFirst({
      where: eq(claims.id, appeal.claimId),
    });

    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    // Fetch patient
    const patient = await db.query.patients.findFirst({
      where: eq(patients.id, claim.patientId),
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Fetch practice
    const practice = await db.query.practices.findFirst({
      where: eq(practices.id, appeal.practiceId),
    });

    if (!practice) {
      return res.status(404).json({ error: 'Practice not found' });
    }

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="fax-cover-${appealId}.pdf"`
    );

    // Create PDF document
    const doc = new PDFDocument({ margin: 72 });
    doc.pipe(res);

    // Title
    doc.fontSize(20).font('Helvetica-Bold').text('FAX COVER SHEET', { align: 'center' });
    doc.moveDown(2);

    // From section
    doc.fontSize(14).font('Helvetica-Bold').text('FROM:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(practice.name);
    if (practice.address) {
      doc.text(practice.address);
    }
    if (practice.phone) {
      doc.text(`Phone: ${practice.phone}`);
    }
    if (practice.npi) {
      doc.text(`NPI: ${practice.npi}`);
    }
    doc.moveDown(1.5);

    // To section
    doc.fontSize(14).font('Helvetica-Bold').text('TO:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');

    // Try to get payer info from claim
    if (claim.payerName) {
      doc.text(claim.payerName);
    } else {
      doc.text('Insurance Payer - Appeals Department');
    }

    if (claim.payerId) {
      doc.text(`Payer ID: ${claim.payerId}`);
    }
    doc.moveDown(1.5);

    // Details section
    doc.fontSize(14).font('Helvetica-Bold').text('RE:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Claim Number: ${claim.claimNumber || claim.id}`);
    doc.text(`Patient Name: ${patient.firstName} ${patient.lastName}`);
    if (patient.dateOfBirth) {
      doc.text(`Date of Birth: ${new Date(patient.dateOfBirth).toLocaleDateString()}`);
    }
    if (appeal.appealLevel) {
      doc.text(`Appeal Level: ${appeal.appealLevel}`);
    }
    doc.moveDown(1.5);

    // Date and pages
    doc.fontSize(11).font('Helvetica');
    doc.text(`Date: ${new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}`);
    doc.text('Number of Pages (including cover): [___]');
    doc.moveDown(2);

    // Message section
    doc.fontSize(14).font('Helvetica-Bold').text('MESSAGE:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(
      'Please find attached the appeal letter and supporting documentation for the above-referenced claim. ' +
      'We kindly request your prompt review and reconsideration of this claim denial.',
      { align: 'left', lineGap: 3 }
    );
    doc.moveDown(2);

    // Confidentiality notice
    doc.fontSize(9).font('Helvetica-Oblique');
    doc.text(
      'CONFIDENTIALITY NOTICE: This facsimile transmission contains confidential information belonging to the sender ' +
      'that is legally privileged. This information is intended only for the use of the individual or entity named above. ' +
      'If you are not the intended recipient, you are hereby notified that any disclosure, copying, distribution, or action ' +
      'taken in reliance on the contents of this transmission is strictly prohibited. If you have received this transmission ' +
      'in error, please notify the sender immediately and destroy the original transmission and its contents.',
      { align: 'left', lineGap: 2 }
    );

    // Finalize PDF
    doc.end();

    logger.info('Generated fax cover sheet', { appealId, practiceId: appeal.practiceId });
  } catch (error) {
    logger.error('Error generating fax cover sheet', { error, appealId: req.params.appealId });
    res.status(500).json({ error: 'Failed to generate fax cover sheet' });
  }
});

export default router;
