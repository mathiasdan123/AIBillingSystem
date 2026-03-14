/**
 * MedicalHistorySection Component
 *
 * Collects medical history, diagnoses, medications, and allergies.
 */

import { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Plus, Trash2 } from 'lucide-react';

interface MedicalHistorySectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function MedicalHistorySection({ data, onChange }: MedicalHistorySectionProps) {
  const { register, watch, setValue, control } = useForm({
    defaultValues: {
      diagnoses: [],
      medications: [],
      allergies: [],
      surgeries: [],
      ...data,
    },
  });

  const { fields: diagnosisFields, append: appendDiagnosis, remove: removeDiagnosis } = useFieldArray({
    control,
    name: 'diagnoses',
  });

  const { fields: medicationFields, append: appendMedication, remove: removeMedication } = useFieldArray({
    control,
    name: 'medications',
  });

  const { fields: allergyFields, append: appendAllergy, remove: removeAllergy } = useFieldArray({
    control,
    name: 'allergies',
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
      {/* Diagnoses */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base font-medium">Diagnoses / Medical Conditions</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => appendDiagnosis({ condition: '', diagnosedDate: '', diagnosedBy: '' })}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Diagnosis
          </Button>
        </div>
        {diagnosisFields.length === 0 && (
          <p className="text-sm text-gray-500 italic">No diagnoses added. Click "Add Diagnosis" to add one.</p>
        )}
        {diagnosisFields.map((field, index) => (
          <div key={field.id} className="grid gap-2 md:grid-cols-4 p-3 border rounded-lg">
            <div className="md:col-span-2">
              <Input
                placeholder="Condition/Diagnosis"
                {...register(`diagnoses.${index}.condition`)}
              />
            </div>
            <Input
              placeholder="Date diagnosed"
              {...register(`diagnoses.${index}.diagnosedDate`)}
            />
            <div className="flex gap-2">
              <Input
                placeholder="Diagnosed by"
                {...register(`diagnoses.${index}.diagnosedBy`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeDiagnosis(index)}
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Medications */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base font-medium">Current Medications</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => appendMedication({ name: '', dosage: '', frequency: '', prescribedFor: '' })}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Medication
          </Button>
        </div>
        {medicationFields.length === 0 && (
          <p className="text-sm text-gray-500 italic">No medications added.</p>
        )}
        {medicationFields.map((field, index) => (
          <div key={field.id} className="grid gap-2 md:grid-cols-5 p-3 border rounded-lg">
            <Input
              placeholder="Medication name"
              {...register(`medications.${index}.name`)}
            />
            <Input
              placeholder="Dosage"
              {...register(`medications.${index}.dosage`)}
            />
            <Input
              placeholder="Frequency"
              {...register(`medications.${index}.frequency`)}
            />
            <Input
              placeholder="Prescribed for"
              {...register(`medications.${index}.prescribedFor`)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeMedication(index)}
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        ))}
      </div>

      {/* Allergies */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base font-medium">Allergies</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => appendAllergy({ allergen: '', reaction: '', severity: '' })}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Allergy
          </Button>
        </div>
        {allergyFields.length === 0 && (
          <p className="text-sm text-gray-500 italic">No allergies added.</p>
        )}
        {allergyFields.map((field, index) => (
          <div key={field.id} className="grid gap-2 md:grid-cols-4 p-3 border rounded-lg">
            <Input
              placeholder="Allergen"
              {...register(`allergies.${index}.allergen`)}
            />
            <Input
              placeholder="Reaction"
              {...register(`allergies.${index}.reaction`)}
            />
            <Input
              placeholder="Severity (mild/moderate/severe)"
              {...register(`allergies.${index}.severity`)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeAllergy(index)}
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        ))}
      </div>

      {/* Hearing & Vision */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <Label className="text-base font-medium">Hearing</Label>
          <div className="space-y-2">
            <Label>Has hearing been screened?</Label>
            <RadioGroup
              value={watchedFields.hearingScreened === true ? 'yes' : watchedFields.hearingScreened === false ? 'no' : ''}
              onValueChange={(value) => setValue('hearingScreened', value === 'yes')}
            >
              <div className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="yes" id="hearingYes" />
                  <Label htmlFor="hearingYes">Yes</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="no" id="hearingNo" />
                  <Label htmlFor="hearingNo">No</Label>
                </div>
              </div>
            </RadioGroup>
            {watchedFields.hearingScreened && (
              <>
                <Input placeholder="Results" {...register('hearingResults')} />
                <Input placeholder="Any concerns?" {...register('hearingConcerns')} />
              </>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-base font-medium">Vision</Label>
          <div className="space-y-2">
            <Label>Has vision been screened?</Label>
            <RadioGroup
              value={watchedFields.visionScreened === true ? 'yes' : watchedFields.visionScreened === false ? 'no' : ''}
              onValueChange={(value) => setValue('visionScreened', value === 'yes')}
            >
              <div className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="yes" id="visionYes" />
                  <Label htmlFor="visionYes">Yes</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="no" id="visionNo" />
                  <Label htmlFor="visionNo">No</Label>
                </div>
              </div>
            </RadioGroup>
            {watchedFields.visionScreened && (
              <>
                <Input placeholder="Results" {...register('visionResults')} />
                <Input placeholder="Any concerns?" {...register('visionConcerns')} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Primary Care Physician */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Primary Care Physician</Label>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            placeholder="Physician name"
            {...register('primaryCarePhysician')}
          />
          <Input
            placeholder="Phone number"
            {...register('physicianPhone')}
          />
        </div>
      </div>
    </div>
  );
}

export default MedicalHistorySection;
