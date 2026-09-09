import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MfaEnrollmentSecret, { extractTotpSecret } from '@/components/MfaEnrollmentSecret';

const URI =
  'otpauth://totp/TherapyBill%20AI:jane%40wonderkids.com?issuer=TherapyBill%20AI&secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30';

describe('extractTotpSecret', () => {
  it('pulls the base32 secret out of an otpauth URI', () => {
    expect(extractTotpSecret(URI)).toBe('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
  });

  it('works when secret is the last query param', () => {
    expect(extractTotpSecret('otpauth://totp/x?issuer=y&secret=ABCD2345')).toBe('ABCD2345');
  });

  it('returns null for a URI with no secret', () => {
    expect(extractTotpSecret('otpauth://totp/x?issuer=y')).toBeNull();
  });
});

describe('MfaEnrollmentSecret', () => {
  it('renders a scannable QR code and the manual setup key', () => {
    render(<MfaEnrollmentSecret uri={URI} />);
    // QR is an SVG rendered from the full otpauth URI
    expect(screen.getByTestId('mfa-qr-code').querySelector('svg')).toBeTruthy();
    // Manual path shows just the secret, not the whole URI
    expect(screen.getByTestId('mfa-manual-secret').textContent).toBe(
      'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    );
    expect(screen.getByTestId('button-copy-mfa-secret')).toBeTruthy();
  });

  it('omits the manual-entry block when the URI has no secret', () => {
    render(<MfaEnrollmentSecret uri="otpauth://totp/x?issuer=y" />);
    expect(screen.queryByTestId('mfa-manual-secret')).toBeNull();
    expect(screen.getByTestId('mfa-qr-code').querySelector('svg')).toBeTruthy();
  });
});
