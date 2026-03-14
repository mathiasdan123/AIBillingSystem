/**
 * SensoryProcessingSection Component
 *
 * Comprehensive sensory processing questionnaire with Likert scales.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { sensoryResponseLabels, type SensoryResponse } from '@/lib/intakeSchema';

interface SensoryProcessingSectionProps {
  data: any;
  onChange: (data: any) => void;
}

const RESPONSE_OPTIONS: SensoryResponse[] = ['never', 'rarely', 'sometimes', 'often', 'always'];

interface SensoryQuestion {
  id: string;
  question: string;
  required: boolean;
}

const SENSORY_QUESTIONS: { category: string; questions: SensoryQuestion[] }[] = [
  {
    category: 'Tactile (Touch)',
    questions: [
      { id: 'toleratesBeingTouched', question: 'Tolerates being touched by others', required: true },
      { id: 'sensitiveToPainTemperature', question: 'Sensitive to pain or temperature', required: true },
      { id: 'sensitiveToClothingTextures', question: 'Sensitive to clothing textures (tags, seams, fabrics)', required: true },
      { id: 'avoidsMessyPlay', question: 'Avoids messy play (paint, glue, sand)', required: false },
      { id: 'seeksTouchInput', question: 'Seeks out touch input (hugs, pressure)', required: false },
      { id: 'difficultyWithGrooming', question: 'Has difficulty with grooming (haircuts, nail trimming, teeth brushing)', required: false },
    ],
  },
  {
    category: 'Auditory (Sound)',
    questions: [
      { id: 'reactsToLoudSounds', question: 'Reacts negatively to loud or sudden sounds', required: true },
      { id: 'distressedByUnexpectedSounds', question: 'Becomes distressed by unexpected sounds', required: true },
      { id: 'difficultyInNoisyEnvironments', question: 'Has difficulty in noisy environments', required: true },
      { id: 'coversEars', question: 'Covers ears frequently', required: false },
      { id: 'seeksSounds', question: 'Seeks out sounds (makes noise, turns up volume)', required: false },
      { id: 'difficultyFollowingVerbalInstructions', question: 'Has difficulty following verbal instructions', required: false },
    ],
  },
  {
    category: 'Visual',
    questions: [
      { id: 'sensitiveToLighting', question: 'Sensitive to bright lights or certain lighting', required: true },
      { id: 'difficultyWithVisualClutter', question: 'Has difficulty with visual clutter', required: true },
      { id: 'avoidsEyeContact', question: 'Avoids eye contact', required: false },
      { id: 'fascinatedByVisualStimuli', question: 'Fascinated by visual stimuli (spinning objects, lights)', required: false },
      { id: 'difficultyFindingObjectsInBusyBackground', question: 'Has difficulty finding objects in busy backgrounds', required: false },
    ],
  },
  {
    category: 'Vestibular & Proprioceptive (Movement & Body Awareness)',
    questions: [
      { id: 'seeksMovementAndJumping', question: 'Seeks movement (spinning, jumping, swinging)', required: true },
      { id: 'avoidsMovementActivities', question: 'Avoids movement activities', required: true },
      { id: 'poorBalance', question: 'Has poor balance or coordination', required: true },
      { id: 'fearOfFalling', question: 'Has fear of falling or heights', required: false },
      { id: 'crashesBumpsIntoThings', question: 'Crashes or bumps into things frequently', required: false },
      { id: 'needsToMoveConstantly', question: 'Needs to move constantly, difficulty sitting still', required: false },
      { id: 'unsafeClimbing', question: 'Climbs on things in unsafe ways', required: false },
      { id: 'poorBodyAwareness', question: 'Seems unaware of body position in space', required: false },
    ],
  },
  {
    category: 'Oral (Mouth)',
    questions: [
      { id: 'pickyEater', question: 'Is a picky eater', required: true },
      { id: 'mouthsObjects', question: 'Mouths or chews on non-food objects', required: true },
      { id: 'gagsOnTextures', question: 'Gags on certain food textures', required: false },
      { id: 'cravesCrunchyFoods', question: 'Craves crunchy or chewy foods', required: false },
      { id: 'drools', question: 'Drools excessively for age', required: false },
    ],
  },
  {
    category: 'Olfactory (Smell)',
    questions: [
      { id: 'sensitiveToSmells', question: 'Sensitive to certain smells', required: false },
      { id: 'seeksSmells', question: 'Seeks out or sniffs objects/people', required: false },
    ],
  },
  {
    category: 'Self-Regulation',
    questions: [
      { id: 'difficultyCalming', question: 'Has difficulty calming down after becoming upset', required: false },
      { id: 'difficultyWithSleep', question: 'Has difficulty with sleep (falling asleep, staying asleep)', required: false },
      { id: 'needsSpecificRoutines', question: 'Needs specific routines or becomes upset with changes', required: false },
    ],
  },
];

export function SensoryProcessingSection({ data, onChange }: SensoryProcessingSectionProps) {
  const { register, watch, setValue } = useForm({ defaultValues: data });
  const watchedFields = watch();

  useEffect(() => {
    const subscription = watch((value) => onChange(value));
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-gray-600 mb-2">
          Please rate how often your child exhibits the following behaviors.
          Questions marked with <Badge variant="destructive" className="text-xs">Required</Badge> must be answered.
        </p>
        <div className="flex gap-2 flex-wrap text-xs text-gray-500">
          {RESPONSE_OPTIONS.map((option) => (
            <span key={option} className="px-2 py-1 bg-gray-100 rounded">
              {sensoryResponseLabels[option]}
            </span>
          ))}
        </div>
      </div>

      {SENSORY_QUESTIONS.map((category) => (
        <div key={category.category} className="space-y-4">
          <h3 className="font-semibold text-lg border-b pb-2">{category.category}</h3>

          {category.questions.map((question) => (
            <div key={question.id} className="space-y-2">
              <div className="flex items-start gap-2">
                <Label className="flex-1">
                  {question.question}
                </Label>
                {question.required && (
                  <Badge variant="destructive" className="text-xs shrink-0">Required</Badge>
                )}
              </div>
              <RadioGroup
                value={watchedFields[question.id] || ''}
                onValueChange={(value) => setValue(question.id, value)}
                className="flex flex-wrap gap-2"
              >
                {RESPONSE_OPTIONS.map((option) => (
                  <div key={option} className="flex items-center">
                    <RadioGroupItem
                      value={option}
                      id={`${question.id}-${option}`}
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor={`${question.id}-${option}`}
                      className="px-3 py-1.5 text-sm border rounded-full cursor-pointer
                        peer-data-[state=checked]:bg-primary peer-data-[state=checked]:text-primary-foreground
                        peer-data-[state=checked]:border-primary hover:bg-gray-100
                        transition-colors"
                    >
                      {sensoryResponseLabels[option]}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          ))}
        </div>
      ))}

      {/* Additional Notes */}
      <div className="space-y-4 pt-4 border-t">
        <div className="space-y-2">
          <Label htmlFor="sensoryNotes">Additional Sensory Concerns or Notes</Label>
          <Textarea
            id="sensoryNotes"
            placeholder="Please describe any additional sensory concerns or observations..."
            {...register('sensoryNotes')}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sensoryStrategiesThatWork">Sensory Strategies That Help</Label>
          <Textarea
            id="sensoryStrategiesThatWork"
            placeholder="What strategies have you found helpful for sensory needs? (e.g., weighted blanket, noise-canceling headphones, fidget tools)"
            {...register('sensoryStrategiesThatWork')}
          />
        </div>
      </div>
    </div>
  );
}

export default SensoryProcessingSection;
