/**
 * TreatmentHistorySection Component
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface TreatmentHistorySectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function TreatmentHistorySection({ data, onChange }: TreatmentHistorySectionProps) {
  const { register, watch, setValue } = useForm({ defaultValues: data });
  const watchedFields = watch();

  useEffect(() => {
    const subscription = watch((value) => onChange(value));
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  const TherapySection = ({ id, label, yesField, detailsPrefix }: {
    id: string;
    label: string;
    yesField: string;
    detailsPrefix: string;
  }) => (
    <div className="space-y-3 p-4 border rounded-lg">
      <div className="space-y-2">
        <Label className="font-medium">{label}</Label>
        <RadioGroup
          value={watchedFields[yesField] === true ? 'yes' : watchedFields[yesField] === false ? 'no' : ''}
          onValueChange={(value) => setValue(yesField, value === 'yes')}
        >
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yes" id={`${id}Yes`} />
              <Label htmlFor={`${id}Yes`}>Yes</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no" id={`${id}No`} />
              <Label htmlFor={`${id}No`}>No</Label>
            </div>
          </div>
        </RadioGroup>
      </div>
      {watchedFields[yesField] && (
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder="Provider/Clinic" {...register(`${detailsPrefix}.provider`)} />
          <Input placeholder="Dates of service" {...register(`${detailsPrefix}.dates`)} />
          <Input placeholder="Frequency" {...register(`${detailsPrefix}.frequency`)} />
          <Input placeholder="Reason for therapy" {...register(`${detailsPrefix}.reason`)} />
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Please indicate if your child has received any of the following therapies:
      </p>

      <TherapySection
        id="ot"
        label="Occupational Therapy (OT)"
        yesField="previousOT"
        detailsPrefix="otDetails"
      />

      <TherapySection
        id="pt"
        label="Physical Therapy (PT)"
        yesField="previousPT"
        detailsPrefix="ptDetails"
      />

      <TherapySection
        id="speech"
        label="Speech Therapy"
        yesField="previousSpeech"
        detailsPrefix="speechDetails"
      />

      <TherapySection
        id="aba"
        label="Applied Behavior Analysis (ABA)"
        yesField="previousABA"
        detailsPrefix="abaDetails"
      />

      <TherapySection
        id="psych"
        label="Psychology / Counseling"
        yesField="previousPsychology"
        detailsPrefix="psychologyDetails"
      />

      <div className="space-y-2">
        <Label htmlFor="currentTherapies">Current Therapies (if any)</Label>
        <Textarea
          id="currentTherapies"
          placeholder="List any current ongoing therapies and providers..."
          {...register('currentTherapies')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="otherInterventions">Other Interventions or Services</Label>
        <Textarea
          id="otherInterventions"
          placeholder="e.g., Early intervention, special education, tutoring..."
          {...register('otherInterventions')}
        />
      </div>
    </div>
  );
}

export default TreatmentHistorySection;
