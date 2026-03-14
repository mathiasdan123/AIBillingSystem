/**
 * HipaaNoticeStep Component
 *
 * Displays the HIPAA Notice of Privacy Practices and collects signature.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { HIPAA_NOTICE_OF_PRIVACY_PRACTICES } from '@/lib/intakeLegalDocs';

interface HipaaNoticeStepProps {
  completed: boolean;
  onSign: (consentType: string, signatureName: string, signatureRelationship: string) => Promise<boolean>;
  onComplete: () => void;
}

export function HipaaNoticeStep({ completed, onSign, onComplete }: HipaaNoticeStepProps) {
  const [hasRead, setHasRead] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [signatureRelationship, setSignatureRelationship] = useState('parent');
  const [isSigning, setIsSigning] = useState(false);

  const handleSign = async () => {
    if (!hasRead || !signatureName.trim()) return;

    setIsSigning(true);
    const success = await onSign('hipaa_privacy_practices', signatureName, signatureRelationship);
    setIsSigning(false);

    if (success) {
      onComplete();
    }
  };

  if (completed) {
    return (
      <div className="text-center py-8">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">HIPAA Notice Acknowledged</h2>
        <p className="text-gray-600">
          You have already acknowledged the Notice of Privacy Practices.
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
        <h2 className="text-xl font-semibold mb-2">Notice of Privacy Practices</h2>
        <p className="text-gray-600 text-sm">
          Please read the following notice carefully and provide your electronic signature below.
        </p>
      </div>

      {/* Document Content */}
      <div className="border rounded-lg">
        <ScrollArea className="h-[400px] p-4">
          <div className="prose prose-sm max-w-none whitespace-pre-wrap font-mono text-xs">
            {HIPAA_NOTICE_OF_PRIVACY_PRACTICES}
          </div>
        </ScrollArea>
      </div>

      {/* Acknowledgment */}
      <div className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
        <Checkbox
          id="hasRead"
          checked={hasRead}
          onCheckedChange={(checked) => setHasRead(checked === true)}
        />
        <Label htmlFor="hasRead" className="text-sm leading-relaxed cursor-pointer">
          I acknowledge that I have received and read this Notice of Privacy Practices.
          I understand my rights regarding my protected health information and how it may
          be used and disclosed.
        </Label>
      </div>

      {/* Signature Fields */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="signatureName">Full Legal Name *</Label>
          <Input
            id="signatureName"
            placeholder="Enter your full legal name"
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="relationship">Relationship to Patient *</Label>
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

      {/* Sign Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSign}
          disabled={!hasRead || !signatureName.trim() || isSigning}
        >
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

export default HipaaNoticeStep;
