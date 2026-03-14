/**
 * NutritionHistorySection Component
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface NutritionHistorySectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function NutritionHistorySection({ data, onChange }: NutritionHistorySectionProps) {
  const { register, watch, setValue } = useForm({ defaultValues: data });
  const watchedFields = watch();

  useEffect(() => {
    const subscription = watch((value) => onChange(value));
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  const YesNoQuestion = ({ id, label, field }: { id: string; label: string; field: string }) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <RadioGroup
        value={watchedFields[field] === true ? 'yes' : watchedFields[field] === false ? 'no' : ''}
        onValueChange={(value) => setValue(field, value === 'yes')}
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
  );

  return (
    <div className="space-y-4">
      <YesNoQuestion
        id="feedingDiff"
        label="Were there any feeding difficulties in infancy?"
        field="feedingDifficultiesInfancy"
      />
      {watchedFields.feedingDifficultiesInfancy && (
        <Textarea
          placeholder="Please describe the feeding difficulties..."
          {...register('feedingDifficultiesDetails')}
        />
      )}

      <YesNoQuestion
        id="currentFeeding"
        label="Are there any current feeding concerns?"
        field="currentFeedingConcerns"
      />
      {watchedFields.currentFeedingConcerns && (
        <Textarea
          placeholder="Please describe current feeding concerns..."
          {...register('feedingConcernsDetails')}
        />
      )}

      <YesNoQuestion
        id="textureAversions"
        label="Does the child have texture aversions to certain foods?"
        field="textureAversions"
      />
      {watchedFields.textureAversions && (
        <Textarea
          placeholder="Please describe texture aversions..."
          {...register('textureAversionsDetails')}
        />
      )}

      <YesNoQuestion
        id="limitedDiet"
        label="Does the child have a limited diet (picky eater)?"
        field="limitedDiet"
      />
      {watchedFields.limitedDiet && (
        <Textarea
          placeholder="Please describe dietary limitations..."
          {...register('limitedDietDetails')}
        />
      )}

      <div className="space-y-2">
        <Label htmlFor="dietaryRestrictions">Dietary Restrictions or Special Diet</Label>
        <Input
          id="dietaryRestrictions"
          placeholder="e.g., Gluten-free, dairy-free, vegetarian"
          {...register('dietaryRestrictions')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="foodAllergies">Food Allergies</Label>
        <Input
          id="foodAllergies"
          placeholder="List any food allergies"
          {...register('foodAllergies')}
        />
      </div>
    </div>
  );
}

export default NutritionHistorySection;
