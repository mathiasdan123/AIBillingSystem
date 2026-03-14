/**
 * EmergencyContactSection Component
 *
 * Collects emergency contact information.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

interface EmergencyContactSectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function EmergencyContactSection({ data, onChange }: EmergencyContactSectionProps) {
  const { register, watch, setValue } = useForm({
    defaultValues: {
      authorizedToPickUp: true,
      ...data,
    },
  });

  const watchedFields = watch();

  useEffect(() => {
    const subscription = watch((value) => {
      onChange(value);
    });
    return () => subscription.unsubscribe();
  }, [watch, onChange]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Please provide a contact who can be reached in case of emergency and is authorized
        to make decisions if a parent/guardian cannot be reached.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Contact Name *</Label>
          <Input
            id="name"
            placeholder="Full name"
            required
            {...register('name')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="relationship">Relationship to Patient *</Label>
          <Input
            id="relationship"
            placeholder="e.g., Grandmother, Uncle, Neighbor"
            required
            {...register('relationship')}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">Primary Phone *</Label>
          <Input
            id="phone"
            type="tel"
            placeholder="(555) 123-4567"
            required
            {...register('phone')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="alternatePhone">Alternate Phone</Label>
          <Input
            id="alternatePhone"
            type="tel"
            placeholder="(555) 123-4567"
            {...register('alternatePhone')}
          />
        </div>
      </div>

      <div className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg">
        <Checkbox
          id="authorizedToPickUp"
          checked={watchedFields.authorizedToPickUp}
          onCheckedChange={(checked) => setValue('authorizedToPickUp', checked === true)}
        />
        <Label htmlFor="authorizedToPickUp" className="cursor-pointer">
          This person is authorized to pick up the patient from appointments
        </Label>
      </div>
    </div>
  );
}

export default EmergencyContactSection;
