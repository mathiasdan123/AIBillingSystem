/**
 * SocialHistorySection Component
 */

import { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2 } from 'lucide-react';

interface SocialHistorySectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function SocialHistorySection({ data, onChange }: SocialHistorySectionProps) {
  const { register, watch, setValue, control } = useForm({
    defaultValues: { siblings: [], familyMedicalHistory: {}, ...data },
  });

  const { fields: siblingFields, append: appendSibling, remove: removeSibling } = useFieldArray({
    control,
    name: 'siblings',
  });

  const watchedFields = watch();

  useEffect(() => {
    const subscription = watch((value) => onChange(value));
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  return (
    <div className="space-y-6">
      {/* Siblings */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base font-medium">Siblings</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => appendSibling({ name: '', age: '', relationship: '', livesInHome: true })}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Sibling
          </Button>
        </div>
        {siblingFields.length === 0 && (
          <p className="text-sm text-gray-500 italic">No siblings added.</p>
        )}
        {siblingFields.map((field, index) => (
          <div key={field.id} className="grid gap-2 md:grid-cols-5 p-3 border rounded-lg items-center">
            <Input placeholder="Name" {...register(`siblings.${index}.name`)} />
            <Input placeholder="Age" {...register(`siblings.${index}.age`)} />
            <Input placeholder="Relationship" {...register(`siblings.${index}.relationship`)} />
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`sibling-${index}-lives`}
                checked={watchedFields.siblings?.[index]?.livesInHome}
                onCheckedChange={(checked) => setValue(`siblings.${index}.livesInHome`, checked === true)}
              />
              <Label htmlFor={`sibling-${index}-lives`} className="text-sm">Lives in home</Label>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeSibling(index)}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        ))}
      </div>

      {/* Family Structure */}
      <div className="space-y-2">
        <Label htmlFor="familyStructure">Family Structure</Label>
        <Textarea
          id="familyStructure"
          placeholder="Describe the family structure (e.g., two-parent household, single parent, blended family)"
          {...register('familyStructure')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="custodyDetails">Custody Details (if applicable)</Label>
        <Input
          id="custodyDetails"
          placeholder="e.g., Joint custody, primary with mother"
          {...register('custodyDetails')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="recentFamilyChanges">Recent Family Changes</Label>
        <Textarea
          id="recentFamilyChanges"
          placeholder="Any recent changes (divorce, new sibling, move, loss of family member)..."
          {...register('recentFamilyChanges')}
        />
      </div>

      {/* Family Medical History */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Family Medical History</Label>
        <p className="text-sm text-gray-600">Check any conditions present in immediate family members:</p>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { id: 'developmentalDelays', label: 'Developmental delays' },
            { id: 'learningDisabilities', label: 'Learning disabilities' },
            { id: 'autism', label: 'Autism Spectrum Disorder' },
            { id: 'adhd', label: 'ADHD' },
            { id: 'mentalHealthConditions', label: 'Mental health conditions' },
            { id: 'geneticConditions', label: 'Genetic conditions' },
          ].map((item) => (
            <div key={item.id} className="flex items-center space-x-2">
              <Checkbox
                id={item.id}
                checked={watchedFields.familyMedicalHistory?.[item.id] || false}
                onCheckedChange={(checked) => setValue(`familyMedicalHistory.${item.id}`, checked === true)}
              />
              <Label htmlFor={item.id}>{item.label}</Label>
            </div>
          ))}
        </div>
        <Textarea
          placeholder="Please provide details about family medical history..."
          {...register('familyMedicalHistory.details')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="childcareArrangements">Childcare Arrangements</Label>
        <Input
          id="childcareArrangements"
          placeholder="e.g., Daycare, nanny, grandparents"
          {...register('childcareArrangements')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="extracurricularActivities">Extracurricular Activities</Label>
        <Textarea
          id="extracurricularActivities"
          placeholder="List any sports, clubs, lessons, or activities..."
          {...register('extracurricularActivities')}
        />
      </div>
    </div>
  );
}

export default SocialHistorySection;
