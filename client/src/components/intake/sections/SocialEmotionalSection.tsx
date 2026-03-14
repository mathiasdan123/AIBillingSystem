/**
 * SocialEmotionalSection Component
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface SocialEmotionalSectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function SocialEmotionalSection({ data, onChange }: SocialEmotionalSectionProps) {
  const { register, watch, setValue } = useForm({ defaultValues: data });
  const watchedFields = watch();

  useEffect(() => {
    const subscription = watch((value) => onChange(value));
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  const YesNoQuestion = ({ id, label, field, detailsField }: {
    id: string; label: string; field: string; detailsField?: string;
  }) => (
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
      {detailsField && watchedFields[field] && (
        <Textarea placeholder="Please provide details..." {...register(detailsField)} />
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Emotional Regulation */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Emotional Regulation</Label>

        <YesNoQuestion
          id="frustrated"
          label="Does the child get frustrated easily?"
          field="frustratedEasily"
        />

        <div className="space-y-2">
          <Label>How often does the child have tantrums or meltdowns?</Label>
          <Select
            value={watchedFields.tantrumFrequency || ''}
            onValueChange={(value) => setValue('tantrumFrequency', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select frequency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="never">Never</SelectItem>
              <SelectItem value="rarely">Rarely (once a month or less)</SelectItem>
              <SelectItem value="sometimes">Sometimes (weekly)</SelectItem>
              <SelectItem value="often">Often (multiple times per week)</SelectItem>
              <SelectItem value="always">Daily or multiple times daily</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(watchedFields.tantrumFrequency && watchedFields.tantrumFrequency !== 'never') && (
          <>
            <div className="space-y-2">
              <Label htmlFor="tantrumDuration">How long do tantrums typically last?</Label>
              <Input id="tantrumDuration" placeholder="e.g., 5-10 minutes" {...register('tantrumDuration')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tantrumTriggers">Common triggers for tantrums</Label>
              <Textarea placeholder="What usually triggers tantrums?" {...register('tantrumTriggers')} />
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label htmlFor="calmingStrategies">What strategies help calm the child?</Label>
          <Textarea
            id="calmingStrategies"
            placeholder="e.g., deep breaths, quiet space, hugs, distraction"
            {...register('calmingStrategies')}
          />
        </div>
      </div>

      {/* Transitions */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Transitions</Label>
        <YesNoQuestion
          id="transition"
          label="Does the child have difficulty with transitions (changing activities)?"
          field="transitionDifficulty"
          detailsField="transitionDetails"
        />
      </div>

      {/* Social Skills */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Social Skills</Label>

        <YesNoQuestion
          id="playsWithPeers"
          label="Does the child play with peers?"
          field="playsWithPeers"
        />

        {watchedFields.playsWithPeers && (
          <div className="space-y-2">
            <Label>Type of play</Label>
            <Select
              value={watchedFields.playType || ''}
              onValueChange={(value) => setValue('playType', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select play type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="solitary">Solitary (plays alone near others)</SelectItem>
                <SelectItem value="parallel">Parallel (plays beside others, not with)</SelectItem>
                <SelectItem value="associative">Associative (plays with others, loosely organized)</SelectItem>
                <SelectItem value="cooperative">Cooperative (organized play with others)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="friendships">Describe friendships</Label>
          <Textarea
            id="friendships"
            placeholder="Does the child have friends? How do they interact with peers?"
            {...register('friendships')}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="socialConcerns">Any social concerns?</Label>
          <Textarea
            id="socialConcerns"
            placeholder="Any concerns about social interactions?"
            {...register('socialConcerns')}
          />
        </div>
      </div>

      {/* Emotional Awareness */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Emotional Awareness</Label>

        <YesNoQuestion
          id="identifiesEmotions"
          label="Can the child identify their own emotions?"
          field="identifiesEmotions"
        />

        <YesNoQuestion
          id="expressesEmotions"
          label="Can the child express emotions appropriately?"
          field="expressesEmotions"
        />

        <div className="space-y-2">
          <Label htmlFor="emotionalConcerns">Emotional awareness concerns</Label>
          <Textarea placeholder="Any concerns about emotional awareness?" {...register('emotionalConcerns')} />
        </div>
      </div>

      {/* Behavior & Attention */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Behavior & Attention</Label>

        <YesNoQuestion
          id="behavior"
          label="Are there any behavior concerns?"
          field="behaviorConcerns"
          detailsField="behaviorDetails"
        />

        <YesNoQuestion
          id="attention"
          label="Are there any attention concerns?"
          field="attentionConcerns"
          detailsField="attentionDetails"
        />

        <YesNoQuestion
          id="impulsivity"
          label="Are there any concerns about impulsivity?"
          field="impulsivityConcerns"
          detailsField="impulsivityDetails"
        />
      </div>

      {/* Anxiety */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Anxiety</Label>

        <YesNoQuestion
          id="anxiety"
          label="Does the child experience anxiety?"
          field="anxietyConcerns"
        />

        {watchedFields.anxietyConcerns && (
          <>
            <div className="space-y-2">
              <Label htmlFor="anxietyTriggers">What triggers anxiety?</Label>
              <Textarea placeholder="Common anxiety triggers..." {...register('anxietyTriggers')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="anxietyManagement">How is anxiety currently managed?</Label>
              <Textarea placeholder="Strategies used to manage anxiety..." {...register('anxietyManagement')} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default SocialEmotionalSection;
