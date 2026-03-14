/**
 * ReviewSubmitStep Component
 *
 * Final review of all intake information before submission.
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Loader2, Send } from 'lucide-react';

interface ReviewSubmitStepProps {
  data: Record<string, any>;
  status: any;
  onSubmit: () => void;
  isSubmitting: boolean;
}

interface ReviewItem {
  label: string;
  value: string | boolean | null | undefined;
}

export function ReviewSubmitStep({ data, status, onSubmit, isSubmitting }: ReviewSubmitStepProps) {
  const steps = status?.steps || {};
  const sections = data?.sections || {};

  // Helper to display a value
  const displayValue = (value: any): string => {
    if (value === null || value === undefined || value === '') return 'Not provided';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.length > 0 ? `${value.length} items` : 'None';
    if (typeof value === 'object') return Object.keys(value).length > 0 ? 'Provided' : 'Not provided';
    return String(value);
  };

  // Get summary items from a section
  const getSummaryItems = (sectionId: string): ReviewItem[] => {
    const sectionData = sections[sectionId] || {};
    const items: ReviewItem[] = [];

    switch (sectionId) {
      case 'patientInfo':
        items.push(
          { label: 'Nickname', value: sectionData.nickname },
          { label: 'Gender', value: sectionData.gender },
          { label: 'School', value: sectionData.school },
          { label: 'Grade', value: sectionData.grade },
        );
        break;
      case 'parent1':
        items.push(
          { label: 'Name', value: sectionData.firstName && sectionData.lastName ? `${sectionData.firstName} ${sectionData.lastName}` : null },
          { label: 'Phone', value: sectionData.phone },
          { label: 'Email', value: sectionData.email },
        );
        break;
      case 'parent2':
        if (sectionData.firstName) {
          items.push(
            { label: 'Name', value: `${sectionData.firstName} ${sectionData.lastName || ''}` },
            { label: 'Phone', value: sectionData.phone },
          );
        }
        break;
      case 'emergencyContact':
        items.push(
          { label: 'Name', value: sectionData.name },
          { label: 'Relationship', value: sectionData.relationship },
          { label: 'Phone', value: sectionData.phone },
        );
        break;
      case 'medicalHistory':
        items.push(
          { label: 'Diagnoses', value: sectionData.diagnoses },
          { label: 'Medications', value: sectionData.medications },
          { label: 'Allergies', value: sectionData.allergies },
        );
        break;
      case 'sensoryProcessing':
        const answered = Object.keys(sectionData).filter(k => sectionData[k] && k !== 'sensoryNotes').length;
        items.push(
          { label: 'Questions Answered', value: `${answered} questions` },
        );
        break;
      default:
        // Generic summary for other sections
        const filled = Object.keys(sectionData).filter(k => sectionData[k] !== null && sectionData[k] !== undefined && sectionData[k] !== '').length;
        if (filled > 0) {
          items.push({ label: 'Fields Completed', value: `${filled} fields` });
        }
    }

    return items;
  };

  const allRequiredComplete =
    steps.hipaaNotice?.completed &&
    steps.waiverRelease?.completed &&
    (steps.creditCardAuth?.completed || steps.creditCardAuth?.skipped || !status?.requireCardOnFile);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Review & Submit</h2>
        <p className="text-gray-600 text-sm">
          Please review your information below before submitting your intake form.
        </p>
      </div>

      {/* Consent Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Consents & Authorizations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span>HIPAA Notice of Privacy Practices</span>
            {steps.hipaaNotice?.completed ? (
              <Badge variant="default" className="bg-green-500">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Signed
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" /> Required
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span>Waiver and Release of Liability</span>
            {steps.waiverRelease?.completed ? (
              <Badge variant="default" className="bg-green-500">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Signed
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" /> Required
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span>Credit Card Authorization</span>
            {steps.creditCardAuth?.completed ? (
              <Badge variant="default" className="bg-green-500">
                <CheckCircle2 className="h-3 w-3 mr-1" /> On File
              </Badge>
            ) : steps.creditCardAuth?.skipped ? (
              <Badge variant="secondary">Skipped</Badge>
            ) : status?.requireCardOnFile ? (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" /> Required
              </Badge>
            ) : (
              <Badge variant="secondary">Optional</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Questionnaire Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Parent Questionnaire Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Patient Info */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-gray-700">Patient Information</h4>
              {getSummaryItems('patientInfo').map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-500">{item.label}:</span>
                  <span>{displayValue(item.value)}</span>
                </div>
              ))}
            </div>

            {/* Parent 1 */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-gray-700">Parent/Guardian 1</h4>
              {getSummaryItems('parent1').map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-500">{item.label}:</span>
                  <span>{displayValue(item.value)}</span>
                </div>
              ))}
            </div>

            {/* Emergency Contact */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-gray-700">Emergency Contact</h4>
              {getSummaryItems('emergencyContact').map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-500">{item.label}:</span>
                  <span>{displayValue(item.value)}</span>
                </div>
              ))}
            </div>

            {/* Medical History */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-gray-700">Medical History</h4>
              {getSummaryItems('medicalHistory').map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-500">{item.label}:</span>
                  <span>{displayValue(item.value)}</span>
                </div>
              ))}
            </div>

            {/* Sensory Processing */}
            <div className="space-y-2 md:col-span-2">
              <h4 className="font-medium text-sm text-gray-700">Sensory Processing</h4>
              {getSummaryItems('sensoryProcessing').map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-500">{item.label}:</span>
                  <span>{displayValue(item.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submit Button */}
      <div className="flex justify-center pt-4">
        <Button
          size="lg"
          onClick={onSubmit}
          disabled={!allRequiredComplete || isSubmitting}
          className="px-8"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              Submit Intake Form
            </>
          )}
        </Button>
      </div>

      {!allRequiredComplete && (
        <p className="text-center text-sm text-red-600">
          Please complete all required consents before submitting.
        </p>
      )}
    </div>
  );
}

export default ReviewSubmitStep;
