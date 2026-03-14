/**
 * PatientInfoSection Component
 *
 * Collects patient demographic information.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PatientInfoSectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function PatientInfoSection({ data, onChange }: PatientInfoSectionProps) {
  const { register, watch, setValue } = useForm({
    defaultValues: data,
  });

  // Watch all fields and call onChange when they change
  const watchedFields = watch();

  useEffect(() => {
    const subscription = watch((value) => {
      onChange(value);
    });
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="nickname">Nickname / Preferred Name</Label>
          <Input
            id="nickname"
            placeholder="What does the child like to be called?"
            {...register('nickname')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="preferredPronouns">Preferred Pronouns</Label>
          <Input
            id="preferredPronouns"
            placeholder="e.g., he/him, she/her, they/them"
            {...register('preferredPronouns')}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="gender">Gender</Label>
          <Select
            value={watchedFields.gender || ''}
            onValueChange={(value) => setValue('gender', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select gender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Other</SelectItem>
              <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="primaryLanguage">Primary Language</Label>
          <Input
            id="primaryLanguage"
            defaultValue="English"
            {...register('primaryLanguage')}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="school">School Name</Label>
          <Input
            id="school"
            placeholder="Current school"
            {...register('school')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="grade">Grade/Class</Label>
          <Input
            id="grade"
            placeholder="e.g., Kindergarten, 1st Grade"
            {...register('grade')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="teacher">Teacher Name</Label>
          <Input
            id="teacher"
            placeholder="Current teacher"
            {...register('teacher')}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="otherLanguages">Other Languages Spoken</Label>
        <Input
          id="otherLanguages"
          placeholder="List any other languages spoken at home"
          {...register('otherLanguages')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="custodyArrangement">Custody Arrangement (if applicable)</Label>
        <Input
          id="custodyArrangement"
          placeholder="e.g., Joint custody, primary with mother"
          {...register('custodyArrangement')}
        />
      </div>
    </div>
  );
}

export default PatientInfoSection;
