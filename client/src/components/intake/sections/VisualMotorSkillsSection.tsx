/**
 * VisualMotorSkillsSection Component
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface VisualMotorSkillsSectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function VisualMotorSkillsSection({ data, onChange }: VisualMotorSkillsSectionProps) {
  const { register, watch, setValue } = useForm({ defaultValues: data });
  const watchedFields = watch();

  useEffect(() => {
    const subscription = watch((value) => onChange(value));
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Hand Dominance</Label>
          <Select
            value={watchedFields.handDominance || ''}
            onValueChange={(value) => setValue('handDominance', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select hand dominance" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="right">Right-handed</SelectItem>
              <SelectItem value="left">Left-handed</SelectItem>
              <SelectItem value="both">Uses both equally</SelectItem>
              <SelectItem value="not_established">Not yet established</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="handDominanceAge">Age hand dominance was established</Label>
          <Input
            id="handDominanceAge"
            placeholder="e.g., 3 years old"
            {...register('handDominanceAge')}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Pencil/Crayon Grasp Pattern</Label>
        <Select
          value={watchedFields.graspPattern || ''}
          onValueChange={(value) => setValue('graspPattern', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select grasp pattern" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tripod">Tripod grasp (3 fingers)</SelectItem>
            <SelectItem value="quadrupod">Quadrupod grasp (4 fingers)</SelectItem>
            <SelectItem value="lateral">Lateral/thumb wrap grasp</SelectItem>
            <SelectItem value="fist">Fist/palmar grasp</SelectItem>
            <SelectItem value="other">Other</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
        {watchedFields.graspPattern === 'other' && (
          <Input placeholder="Please describe..." {...register('graspPatternDetails')} />
        )}
      </div>

      <div className="space-y-2">
        <Label>Drawing Ability (select highest level achieved)</Label>
        <Select
          value={watchedFields.drawingAbility || ''}
          onValueChange={(value) => setValue('drawingAbility', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select drawing ability" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="scribbles">Scribbles</SelectItem>
            <SelectItem value="circles">Can draw circles</SelectItem>
            <SelectItem value="crosses">Can draw crosses (+)</SelectItem>
            <SelectItem value="squares">Can draw squares</SelectItem>
            <SelectItem value="triangles">Can draw triangles</SelectItem>
            <SelectItem value="letters">Can write some letters</SelectItem>
            <SelectItem value="numbers">Can write letters and numbers</SelectItem>
            <SelectItem value="complex">Can draw complex pictures</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <Label>Are there any concerns with writing or drawing?</Label>
        <RadioGroup
          value={watchedFields.writingConcerns === true ? 'yes' : watchedFields.writingConcerns === false ? 'no' : ''}
          onValueChange={(value) => setValue('writingConcerns', value === 'yes')}
        >
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yes" id="writingYes" />
              <Label htmlFor="writingYes">Yes</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no" id="writingNo" />
              <Label htmlFor="writingNo">No</Label>
            </div>
          </div>
        </RadioGroup>
        {watchedFields.writingConcerns && (
          <Textarea
            placeholder="Please describe concerns with writing/drawing..."
            {...register('writingConcernsDetails')}
          />
        )}
      </div>

      <div className="space-y-2">
        <Label>Scissor Skills</Label>
        <Select
          value={watchedFields.scissorSkills || ''}
          onValueChange={(value) => setValue('scissorSkills', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select scissor skill level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="not_yet">Not using scissors yet</SelectItem>
            <SelectItem value="snips">Can snip paper</SelectItem>
            <SelectItem value="lines">Can cut along straight lines</SelectItem>
            <SelectItem value="curves">Can cut curves</SelectItem>
            <SelectItem value="shapes">Can cut out shapes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="puzzleSkills">Puzzle Skills</Label>
        <Input
          id="puzzleSkills"
          placeholder="e.g., Can complete 24-piece puzzles"
          {...register('puzzleSkills')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="constructionSkills">Building/Construction Skills</Label>
        <Input
          id="constructionSkills"
          placeholder="e.g., Builds with Legos, blocks"
          {...register('constructionSkills')}
        />
      </div>

      <div className="space-y-3">
        <Label>Any concerns with eye-hand coordination?</Label>
        <RadioGroup
          value={watchedFields.eyeHandCoordinationConcerns === true ? 'yes' : watchedFields.eyeHandCoordinationConcerns === false ? 'no' : ''}
          onValueChange={(value) => setValue('eyeHandCoordinationConcerns', value === 'yes')}
        >
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yes" id="eyeHandYes" />
              <Label htmlFor="eyeHandYes">Yes</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no" id="eyeHandNo" />
              <Label htmlFor="eyeHandNo">No</Label>
            </div>
          </div>
        </RadioGroup>
        {watchedFields.eyeHandCoordinationConcerns && (
          <Textarea
            placeholder="Please describe eye-hand coordination concerns..."
            {...register('eyeHandDetails')}
          />
        )}
      </div>
    </div>
  );
}

export default VisualMotorSkillsSection;
