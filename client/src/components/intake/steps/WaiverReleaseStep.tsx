/**
 * WaiverReleaseStep Component
 *
 * Displays the Waiver and Release of Liability and collects signature.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { WAIVER_AND_RELEASE_OF_LIABILITY } from '@/lib/intakeLegalDocs';

interface WaiverReleaseStepProps {
  completed: boolean;
  onSign: (consentType: string, signatureName: string, signatureRelationship: string) => Promise<boolean>;
  onComplete: () => void;
}

export function WaiverReleaseStep({ completed, onSign, onComplete }: WaiverReleaseStepProps) {
  const [hasRead, setHasRead] = useState(false);
  const [photoRelease, setPhotoRelease] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [signatureRelationship, setSignatureRelationship] = useState('parent');
  const [isSigning, setIsSigning] = useState(false);

  const handleSign = async () => {
    if (!hasRead || !signatureName.trim()) return;

    setIsSigning(true);
    const success = await onSign('waiver_release', signatureName, signatureRelationship);
    setIsSigning(false);

    if (success) {
      onComplete();
    }
  };

  if (completed) {
    return (
      <div className="text-center py-8">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Waiver Signed</h2>
        <p className="text-gray-600">
          You have already signed the Waiver and Release of Liability.
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
        <h2 className="text-xl font-semibold mb-2">Waiver and Release of Liability</h2>
        <p className="text-gray-600 text-sm">
          Please read the following waiver carefully and provide your electronic signature below.
        </p>
      </div>

      {/* Document Content */}
      <div className="border rounded-lg">
        <ScrollArea className="h-[400px] p-4">
          <div className="prose prose-sm max-w-none whitespace-pre-wrap font-mono text-xs">
            {WAIVER_AND_RELEASE_OF_LIABILITY}
          </div>
        </ScrollArea>
      </div>

      {/* Acknowledgments */}
      <div className="space-y-4">
        <div className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
          <Checkbox
            id="hasRead"
            checked={hasRead}
            onCheckedChange={(checked) => setHasRead(checked === true)}
          />
          <Label htmlFor="hasRead" className="text-sm leading-relaxed cursor-pointer">
            I have read and understand this Waiver and Release of Liability. I acknowledge that
            I am signing this waiver voluntarily and agree to be bound by its terms. I understand
            the inherent risks associated with occupational therapy services.
          </Label>
        </div>

        <div className="flex items-start space-x-3 p-4 bg-blue-50 rounded-lg">
          <Checkbox
            id="photoRelease"
            checked={photoRelease}
            onCheckedChange={(checked) => setPhotoRelease(checked === true)}
          />
          <Label htmlFor="photoRelease" className="text-sm leading-relaxed cursor-pointer">
            <span className="font-medium">(Optional)</span> I authorize the practice to take
            photographs or videos during therapy sessions for documentation and educational purposes.
          </Label>
        </div>
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

export default WaiverReleaseStep;
