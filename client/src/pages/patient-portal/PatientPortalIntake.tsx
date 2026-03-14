/**
 * PatientPortalIntake Page
 *
 * Main page for the patient intake wizard in the patient portal.
 */

import { IntakeWizard } from '@/components/intake/IntakeWizard';

interface PatientPortalIntakeProps {
  portalToken: string;
}

export function PatientPortalIntake({ portalToken }: PatientPortalIntakeProps) {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <IntakeWizard portalToken={portalToken} />
    </div>
  );
}

export default PatientPortalIntake;
