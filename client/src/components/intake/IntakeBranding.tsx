/**
 * IntakeBranding Component
 *
 * Displays practice branding (logo, name) at the top of all intake pages.
 */

import { Building2 } from 'lucide-react';

interface IntakeBrandingProps {
  practiceName: string;
  logoUrl?: string | null;
  primaryColor?: string;
}

export function IntakeBranding({ practiceName, logoUrl, primaryColor = '#2563eb' }: IntakeBrandingProps) {
  return (
    <div className="mb-6 text-center">
      <div className="flex items-center justify-center gap-3 mb-2">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${practiceName} logo`}
            className="h-12 w-auto object-contain"
          />
        ) : (
          <div
            className="h-12 w-12 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: primaryColor }}
          >
            <Building2 className="h-6 w-6 text-white" />
          </div>
        )}
        <h1 className="text-2xl font-bold text-gray-900">{practiceName}</h1>
      </div>
      <p className="text-gray-600">Patient Intake Form</p>
    </div>
  );
}

export default IntakeBranding;
