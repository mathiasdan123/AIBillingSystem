/**
 * BenefitsAuthorizationStep Component
 *
 * Optional intake step that captures the patient's Assignment of Benefits +
 * Authorized Representative designation — the legal key that lets the practice
 * (and its billing agent) retrieve benefit data and act as the patient's
 * authorized representative in appeals. This is the "Sheer for practices"
 * payer-advocacy consent.
 *
 * ⚠️ Gated behind the practice flag `benefitsAuthEnabled` (default OFF). The
 * consent text is DRAFT pending health-law counsel review — the wizard only
 * renders this step when the flag is on.
 *
 * Signs TWO consents in one action: assignment_of_benefits +
 * authorized_representative (both are needed; AOB = get paid + pull data,
 * authorized_representative = act/appeal on the patient's behalf).
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, Loader2, ShieldCheck, Info } from 'lucide-react';
import { BENEFITS_AUTHORIZATION_TEXT } from '@/lib/intakeLegalDocs';

interface BenefitsAuthorizationStepProps {
  completed: boolean;
  onSign: (consentType: string, signatureName: string, signatureRelationship: string) => Promise<boolean>;
  onComplete: () => void;
}

export function BenefitsAuthorizationStep({ completed, onSign, onComplete }: BenefitsAuthorizationStepProps) {
  const [hasRead, setHasRead] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [signatureRelationship, setSignatureRelationship] = useState('parent');
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSign = async () => {
    if (!hasRead || !signatureName.trim()) return;
    setIsSigning(true);
    setError(null);
    // Both consents are required; sign them in sequence. If either fails,
    // surface an error rather than advancing.
    const aob = await onSign('assignment_of_benefits', signatureName, signatureRelationship);
    const rep = aob
      ? await onSign('authorized_representative', signatureName, signatureRelationship)
      : false;
    setIsSigning(false);
    if (aob && rep) {
      onComplete();
    } else {
      setError('We could not record your authorization. Please try again.');
    }
  };

  if (completed) {
    return (
      <div className="text-center py-8">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Benefits Authorization Signed</h2>
        <p className="text-gray-600">
          You have authorized the practice to manage your insurance benefits and appeals.
        </p>
        <Button className="mt-4" onClick={onComplete}>
          Continue to Next Step
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-600" />
          Insurance Benefits Authorization
        </h2>
        <p className="text-gray-600 text-sm">
          This lets the practice handle your insurance on your behalf — verifying your benefits,
          catching billing errors, and appealing denials so you get the coverage you're owed.
        </p>
      </div>

      <Alert className="bg-blue-50 border-blue-200">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          We will <strong>never</strong> ask for your insurance company password. Your
          authorization here is all we need to advocate for you with your plan.
        </AlertDescription>
      </Alert>

      {/* Document Content */}
      <div className="border rounded-lg">
        <ScrollArea className="h-[360px] p-4">
          <div className="prose prose-sm max-w-none whitespace-pre-wrap font-mono text-xs">
            {BENEFITS_AUTHORIZATION_TEXT}
          </div>
        </ScrollArea>
      </div>

      {/* Acknowledgment */}
      <div className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
        <Checkbox
          id="hasReadBenefitsAuth"
          checked={hasRead}
          onCheckedChange={(checked) => setHasRead(checked === true)}
        />
        <Label htmlFor="hasReadBenefitsAuth" className="text-sm leading-relaxed cursor-pointer">
          I have read and understand this Assignment of Benefits and Authorized Representative
          Designation. I authorize the practice and its billing agent to obtain my benefit
          information and to act as my authorized representative in claims and appeals with my
          health plan.
        </Label>
      </div>

      {/* Signature Fields */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="benefitsAuthName">Full Legal Name *</Label>
          <Input
            id="benefitsAuthName"
            placeholder="Enter your full legal name"
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="benefitsAuthRelationship">Relationship to Patient *</Label>
          <Select value={signatureRelationship} onValueChange={setSignatureRelationship}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">Self (Patient)</SelectItem>
              <SelectItem value="parent">Parent</SelectItem>
              <SelectItem value="guardian">Legal Guardian</SelectItem>
              <SelectItem value="legal_representative">Legal Representative</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Sign Button */}
      <div className="flex justify-end">
        <Button onClick={handleSign} disabled={!hasRead || !signatureName.trim() || isSigning}>
          {isSigning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Signing...
            </>
          ) : (
            'Sign & Continue'
          )}
        </Button>
      </div>
    </div>
  );
}

export default BenefitsAuthorizationStep;
