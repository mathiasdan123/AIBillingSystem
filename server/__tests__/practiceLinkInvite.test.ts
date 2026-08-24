/**
 * The public-link invitation is the ONE invitation that may be sent to an
 * address which is not on a patient record — a prospective patient who called
 * to ask how to book. That is only safe because the page it points at is
 * public and the email carries nothing about anyone's health.
 *
 * The portal invite is its opposite: a personal magic link, sent only to the
 * address already on the patient's record. Confusing the two is how a portal
 * link ends up in a stranger's inbox, so these tests pin the distinction.
 */
import { describe, it, expect } from 'vitest';
import { practiceLinkInvite } from '../services/emailTemplates';

const base = {
  practiceName: 'Wonder Kids Therapy Center',
  siteUrl: 'https://app.therapybillai.com/book/wonder-kids',
};

describe('practiceLinkInvite', () => {
  it('sends the public booking page and says the portal is reachable from it', () => {
    const email = practiceLinkInvite(base);

    expect(email.html).toContain(base.siteUrl);
    expect(email.text).toContain(base.siteUrl);
    expect(email.text.toLowerCase()).toContain('portal');
  });

  it('carries no patient identity — it is not addressed to anyone', () => {
    const email = practiceLinkInvite(base);
    const body = `${email.subject} ${email.html} ${email.text}`.toLowerCase();

    // No magic-link token, no patient name slot, no personal greeting.
    expect(body).not.toContain('/portal/login/');
    expect(body).not.toMatch(/dear |hi [a-z]+,/);
  });

  it('never emits a portal magic-link path, even with a hostile note', () => {
    const email = practiceLinkInvite({
      ...base,
      message: 'Reference: /portal/login/abc123',
    });

    // The note is echoed as text, but it must be escaped, not turned into a
    // live credential-bearing link.
    expect(email.html).not.toMatch(/href="[^"]*\/portal\/login\//);
  });

  it('escapes a note so it cannot inject markup into the email', () => {
    const email = practiceLinkInvite({
      ...base,
      message: '<script>alert(1)</script>',
    });

    expect(email.html).not.toContain('<script>');
  });

  it('includes an optional staff note when supplied', () => {
    const email = practiceLinkInvite({ ...base, message: 'Ask for Jessann when you call.' });
    expect(email.text).toContain('Ask for Jessann when you call.');
  });

  it('reassures a recipient who was not expecting it', () => {
    const email = practiceLinkInvite(base);
    expect(email.text.toLowerCase()).toContain('no personal information');
  });
});
