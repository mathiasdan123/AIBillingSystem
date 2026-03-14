/**
 * ParentInfoSection Component
 *
 * Collects parent/guardian information.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ParentInfoSectionProps {
  data: any;
  onChange: (data: any) => void;
}

export function ParentInfoSection({ data, onChange }: ParentInfoSectionProps) {
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
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="firstName">First Name *</Label>
          <Input
            id="firstName"
            required
            {...register('firstName')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name *</Label>
          <Input
            id="lastName"
            required
            {...register('lastName')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="relationship">Relationship to Patient *</Label>
          <Select
            value={watchedFields.relationship || ''}
            onValueChange={(value) => setValue('relationship', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select relationship" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mother">Mother</SelectItem>
              <SelectItem value="father">Father</SelectItem>
              <SelectItem value="stepmother">Stepmother</SelectItem>
              <SelectItem value="stepfather">Stepfather</SelectItem>
              <SelectItem value="grandmother">Grandmother</SelectItem>
              <SelectItem value="grandfather">Grandfather</SelectItem>
              <SelectItem value="guardian">Legal Guardian</SelectItem>
              <SelectItem value="foster_parent">Foster Parent</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone Number *</Label>
          <Input
            id="phone"
            type="tel"
            placeholder="(555) 123-4567"
            required
            {...register('phone')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email Address *</Label>
          <Input
            id="email"
            type="email"
            placeholder="email@example.com"
            required
            {...register('email')}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">Street Address</Label>
        <Input
          id="address"
          placeholder="123 Main St"
          {...register('address')}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            {...register('city')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="state">State</Label>
          <Input
            id="state"
            maxLength={2}
            placeholder="CA"
            {...register('state')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="zip">ZIP Code</Label>
          <Input
            id="zip"
            maxLength={10}
            placeholder="12345"
            {...register('zip')}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="employer">Employer</Label>
          <Input
            id="employer"
            placeholder="Company name"
            {...register('employer')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="occupation">Occupation</Label>
          <Input
            id="occupation"
            placeholder="Job title"
            {...register('occupation')}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="workPhone">Work Phone</Label>
        <Input
          id="workPhone"
          type="tel"
          placeholder="(555) 123-4567"
          {...register('workPhone')}
        />
      </div>
    </div>
  );
}

export default ParentInfoSection;
