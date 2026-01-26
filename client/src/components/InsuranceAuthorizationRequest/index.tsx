import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Shield, Mail, Phone, Send, Loader2, AlertCircle, CheckCircle } from 'lucide-react';

interface Patient {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

interface InsuranceAuthorizationRequestProps {
  patient: Patient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const scopeOptions = [
  { id: 'eligibility', label: 'Insurance Eligibility', description: 'Verify coverage status' },
  { id: 'benefits', label: 'Benefits Information', description: 'Deductibles, copays, limits' },
  { id: 'claims_history', label: 'Claims History', description: 'Past claims and payments' },
  { id: 'prior_auth', label: 'Prior Authorization', description: 'Auth requirements' },
];

export default function InsuranceAuthorizationRequest({
  patient,
  open,
  onOpenChange,
  onSuccess,
}: InsuranceAuthorizationRequestProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [deliveryMethod, setDeliveryMethod] = useState<'email' | 'sms' | 'both'>('email');
  const [deliveryEmail, setDeliveryEmail] = useState(patient.email || '');
  const [deliveryPhone, setDeliveryPhone] = useState(patient.phone || '');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['eligibility', 'benefits']);

  // Create authorization mutation
  const createAuthMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/insurance-authorizations', {
        patientId: patient.id,
        scopes: selectedScopes,
        deliveryMethod,
        deliveryEmail: deliveryMethod !== 'sms' ? deliveryEmail : undefined,
        deliveryPhone: deliveryMethod !== 'email' ? deliveryPhone : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create authorization');
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Authorization Request Sent',
        description: data.message || `Request sent to ${patient.firstName}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/patients'] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast({
        title: 'Failed to Send Request',
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      });
    },
  });

  const toggleScope = (scopeId: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId]
    );
  };

  const canSubmit =
    selectedScopes.length > 0 &&
    ((deliveryMethod === 'email' && deliveryEmail) ||
      (deliveryMethod === 'sms' && deliveryPhone) ||
      (deliveryMethod === 'both' && deliveryEmail && deliveryPhone));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Request Insurance Access
          </DialogTitle>
          <DialogDescription>
            Send an authorization request to{' '}
            <strong>
              {patient.firstName} {patient.lastName}
            </strong>{' '}
            to access their insurance information.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Delivery Method */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Delivery Method</Label>
            <RadioGroup
              value={deliveryMethod}
              onValueChange={(value) => setDeliveryMethod(value as any)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="email" id="email" />
                <Label htmlFor="email" className="flex items-center gap-1 cursor-pointer">
                  <Mail className="w-4 h-4" />
                  Email
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="sms" id="sms" />
                <Label htmlFor="sms" className="flex items-center gap-1 cursor-pointer">
                  <Phone className="w-4 h-4" />
                  SMS
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="both" id="both" />
                <Label htmlFor="both" className="cursor-pointer">
                  Both
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Contact Details */}
          <div className="space-y-3">
            {(deliveryMethod === 'email' || deliveryMethod === 'both') && (
              <div className="space-y-1.5">
                <Label htmlFor="deliveryEmail">Email Address</Label>
                <Input
                  id="deliveryEmail"
                  type="email"
                  value={deliveryEmail}
                  onChange={(e) => setDeliveryEmail(e.target.value)}
                  placeholder="patient@example.com"
                />
              </div>
            )}
            {(deliveryMethod === 'sms' || deliveryMethod === 'both') && (
              <div className="space-y-1.5">
                <Label htmlFor="deliveryPhone">Phone Number</Label>
                <Input
                  id="deliveryPhone"
                  type="tel"
                  value={deliveryPhone}
                  onChange={(e) => setDeliveryPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
            )}
          </div>

          {/* Scopes */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Data to Request Access To</Label>
            <div className="space-y-2">
              {scopeOptions.map((scope) => (
                <div
                  key={scope.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedScopes.includes(scope.id)
                      ? 'bg-blue-50 border-blue-200'
                      : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                  onClick={() => toggleScope(scope.id)}
                >
                  <Checkbox
                    checked={selectedScopes.includes(scope.id)}
                    onCheckedChange={() => toggleScope(scope.id)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-sm">{scope.label}</div>
                    <div className="text-xs text-gray-500">{scope.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="flex gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">Patient Consent Required</p>
                <p className="text-amber-700 mt-1">
                  The patient will receive a link to review and authorize access. Data will only be
                  retrieved after they consent.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createAuthMutation.mutate()}
            disabled={!canSubmit || createAuthMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {createAuthMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send Request
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
