/**
 * BirthHistorySection Component
 *
 * Collects birth and pregnancy history.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface BirthHistorySectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function BirthHistorySection({ data, onChange }: BirthHistorySectionProps) {
  const { register, watch, setValue } = useForm({
    defaultValues: data,
  });

  const watchedFields = watch();

  useEffect(() => {
    const subscription = watch((value) => {
      onChange(value);
    });
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="birthWeight">Birth Weight</Label>
          <Input
            id="birthWeight"
            placeholder="e.g., 7 lbs 4 oz"
            {...register('birthWeight')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gestationalAge">Gestational Age at Birth</Label>
          <Input
            id="gestationalAge"
            placeholder="e.g., 39 weeks"
            {...register('gestationalAge')}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Type of Delivery</Label>
        <RadioGroup
          value={watchedFields.deliveryType || ''}
          onValueChange={(value) => setValue('deliveryType', value)}
        >
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="vaginal" id="vaginal" />
              <Label htmlFor="vaginal">Vaginal</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="cesarean" id="cesarean" />
              <Label htmlFor="cesarean">Cesarean (C-section)</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="unknown" id="unknown" />
              <Label htmlFor="unknown">Unknown</Label>
            </div>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label>Were there any complications during birth?</Label>
        <RadioGroup
          value={watchedFields.birthComplications === true ? 'yes' : watchedFields.birthComplications === false ? 'no' : ''}
          onValueChange={(value) => setValue('birthComplications', value === 'yes')}
        >
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yes" id="birthCompYes" />
              <Label htmlFor="birthCompYes">Yes</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no" id="birthCompNo" />
              <Label htmlFor="birthCompNo">No</Label>
            </div>
          </div>
        </RadioGroup>
        {watchedFields.birthComplications && (
          <Textarea
            placeholder="Please describe any birth complications..."
            {...register('birthComplicationsDetails')}
          />
        )}
      </div>

      <div className="space-y-2">
        <Label>Did the baby require NICU (Neonatal Intensive Care Unit) stay?</Label>
        <RadioGroup
          value={watchedFields.nicuStay === true ? 'yes' : watchedFields.nicuStay === false ? 'no' : ''}
          onValueChange={(value) => setValue('nicuStay', value === 'yes')}
        >
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yes" id="nicuYes" />
              <Label htmlFor="nicuYes">Yes</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no" id="nicuNo" />
              <Label htmlFor="nicuNo">No</Label>
            </div>
          </div>
        </RadioGroup>
        {watchedFields.nicuStay && (
          <div className="grid gap-4 md:grid-cols-2 mt-2">
            <div className="space-y-2">
              <Label htmlFor="nicuDuration">Duration of NICU stay</Label>
              <Input
                id="nicuDuration"
                placeholder="e.g., 2 weeks"
                {...register('nicuDuration')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nicuReason">Reason for NICU stay</Label>
              <Input
                id="nicuReason"
                placeholder="e.g., Jaundice, breathing issues"
                {...register('nicuReason')}
              />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Were there any complications during pregnancy?</Label>
        <RadioGroup
          value={watchedFields.pregnancyComplications === true ? 'yes' : watchedFields.pregnancyComplications === false ? 'no' : ''}
          onValueChange={(value) => setValue('pregnancyComplications', value === 'yes')}
        >
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yes" id="pregCompYes" />
              <Label htmlFor="pregCompYes">Yes</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no" id="pregCompNo" />
              <Label htmlFor="pregCompNo">No</Label>
            </div>
          </div>
        </RadioGroup>
        {watchedFields.pregnancyComplications && (
          <Textarea
            placeholder="Please describe any pregnancy complications..."
            {...register('pregnancyComplicationsDetails')}
          />
        )}
      </div>
    </div>
  );
}

export default BirthHistorySection;
