/**
 * DevelopmentalMilestonesSection Component
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface DevelopmentalMilestonesSectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function DevelopmentalMilestonesSection({ data, onChange }: DevelopmentalMilestonesSectionProps) {
  const { register, watch, setValue } = useForm({ defaultValues: data });
  const watchedFields = watch();

  useEffect(() => {
    const subscription = watch((value) => onChange(value));
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  const MilestoneInput = ({ id, label, placeholder }: { id: string; label: string; placeholder: string }) => (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      <Input id={id} placeholder={placeholder} {...register(id)} />
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Please provide approximate ages (in months) when your child reached the following milestones.
        If unknown, leave blank.
      </p>

      {/* Gross Motor */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Gross Motor Milestones</Label>
        <div className="grid gap-4 md:grid-cols-2">
          <MilestoneInput id="satIndependently" label="Sat independently" placeholder="e.g., 6 months" />
          <MilestoneInput id="crawled" label="Crawled" placeholder="e.g., 8 months" />
          <MilestoneInput id="walkedIndependently" label="Walked independently" placeholder="e.g., 12 months" />
          <MilestoneInput id="ranFluidly" label="Ran fluently" placeholder="e.g., 18 months" />
          <MilestoneInput id="climbedStairs" label="Climbed stairs" placeholder="e.g., 24 months" />
          <MilestoneInput id="jumpedBothFeet" label="Jumped with both feet" placeholder="e.g., 24 months" />
          <MilestoneInput id="rodeTricycle" label="Rode tricycle/bike" placeholder="e.g., 36 months" />
        </div>
      </div>

      {/* Fine Motor */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Fine Motor Milestones</Label>
        <div className="grid gap-4 md:grid-cols-2">
          <MilestoneInput id="reachedForObjects" label="Reached for objects" placeholder="e.g., 4 months" />
          <MilestoneInput id="transferredObjects" label="Transferred objects hand to hand" placeholder="e.g., 6 months" />
          <MilestoneInput id="usedPincerGrasp" label="Used pincer grasp" placeholder="e.g., 9 months" />
          <MilestoneInput id="scribbled" label="Scribbled with crayon" placeholder="e.g., 12 months" />
          <MilestoneInput id="usedUtensils" label="Used utensils" placeholder="e.g., 18 months" />
          <MilestoneInput id="buttoned" label="Buttoned/unbuttoned" placeholder="e.g., 36 months" />
          <MilestoneInput id="usedScissors" label="Used scissors" placeholder="e.g., 48 months" />
        </div>
      </div>

      {/* Language */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Language Milestones</Label>
        <div className="grid gap-4 md:grid-cols-2">
          <MilestoneInput id="firstWords" label="First words" placeholder="e.g., 12 months" />
          <MilestoneInput id="combinedWords" label="Combined 2 words" placeholder="e.g., 18-24 months" />
          <MilestoneInput id="usedSentences" label="Used sentences" placeholder="e.g., 24-36 months" />
          <MilestoneInput id="followedDirections" label="Followed 2-step directions" placeholder="e.g., 24 months" />
        </div>
      </div>

      {/* Self-Care */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Self-Care Milestones</Label>
        <div className="grid gap-4 md:grid-cols-2">
          <MilestoneInput id="toiletTrainedDay" label="Toilet trained (daytime)" placeholder="e.g., 30 months" />
          <MilestoneInput id="toiletTrainedNight" label="Toilet trained (nighttime)" placeholder="e.g., 36 months" />
          <MilestoneInput id="dressedIndependently" label="Dressed independently" placeholder="e.g., 48 months" />
          <MilestoneInput id="brushedTeeth" label="Brushed teeth independently" placeholder="e.g., 60 months" />
        </div>
      </div>

      {/* Concerns */}
      <div className="space-y-3">
        <Label>Were there any concerns about developmental delays?</Label>
        <RadioGroup
          value={watchedFields.delaysConcerns === true ? 'yes' : watchedFields.delaysConcerns === false ? 'no' : ''}
          onValueChange={(value) => setValue('delaysConcerns', value === 'yes')}
        >
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yes" id="delaysYes" />
              <Label htmlFor="delaysYes">Yes</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no" id="delaysNo" />
              <Label htmlFor="delaysNo">No</Label>
            </div>
          </div>
        </RadioGroup>
        {watchedFields.delaysConcerns && (
          <Textarea placeholder="Please describe concerns..." {...register('delayDetails')} />
        )}
      </div>

      <div className="space-y-3">
        <Label>Has there been any regression (loss of previously acquired skills)?</Label>
        <RadioGroup
          value={watchedFields.regressionHistory === true ? 'yes' : watchedFields.regressionHistory === false ? 'no' : ''}
          onValueChange={(value) => setValue('regressionHistory', value === 'yes')}
        >
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yes" id="regressionYes" />
              <Label htmlFor="regressionYes">Yes</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no" id="regressionNo" />
              <Label htmlFor="regressionNo">No</Label>
            </div>
          </div>
        </RadioGroup>
        {watchedFields.regressionHistory && (
          <Textarea placeholder="Please describe regression..." {...register('regressionDetails')} />
        )}
      </div>
    </div>
  );
}

export default DevelopmentalMilestonesSection;
