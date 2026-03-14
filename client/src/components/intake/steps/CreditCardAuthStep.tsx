/**
 * CreditCardAuthStep Component
 *
 * Collects credit card information using Stripe Elements.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, CreditCard, Loader2, AlertCircle, SkipForward } from 'lucide-react';
import { CREDIT_CARD_AUTHORIZATION_TEXT, FINANCIAL_RESPONSIBILITY_AGREEMENT } from '@/lib/intakeLegalDocs';

// Load Stripe outside of component to avoid recreating on every render
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY || '');

interface CreditCardAuthStepProps {
  portalToken: string;
  required: boolean;
  completed: boolean;
  skipped: boolean;
  onComplete: () => void;
}

function CreditCardForm({
  portalToken,
  required,
  onComplete,
}: {
  portalToken: string;
  required: boolean;
  onComplete: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [hasRead, setHasRead] = useState(false);
  const [billingName, setBillingName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingZip, setBillingZip] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Create SetupIntent
  const { data: setupData, isLoading: setupLoading, error: setupError } = useQuery({
    queryKey: ['setup-intent'],
    queryFn: async () => {
      const res = await fetch('/api/patient-portal/intake/setup-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${portalToken}`,
        },
      });
      if (!res.ok) throw new Error('Failed to create setup intent');
      return res.json();
    },
  });

  // Save payment method mutation
  const savePaymentMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const res = await fetch('/api/patient-portal/intake/save-payment-method', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${portalToken}`,
        },
        body: JSON.stringify({
          stripePaymentMethodId: paymentMethodId,
          billingName,
          billingAddress,
          billingCity,
          billingState,
          billingZip,
        }),
      });
      if (!res.ok) throw new Error('Failed to save payment method');
      return res.json();
    },
  });

  // Sign card authorization consent mutation
  const signConsentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/patient-portal/intake/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${portalToken}`,
        },
        body: JSON.stringify({
          consentType: 'card_authorization',
          signatureName: billingName,
          signatureRelationship: 'self',
        }),
      });
      if (!res.ok) throw new Error('Failed to create consent');
      return res.json();
    },
  });

  // Skip card authorization mutation
  const skipCardMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/patient-portal/intake/skip-card', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${portalToken}`,
        },
      });
      if (!res.ok) throw new Error('Failed to skip card authorization');
      return res.json();
    },
  });

  const handleSubmit = async () => {
    if (!stripe || !elements || !setupData?.clientSecret) {
      return;
    }

    if (!hasRead || !billingName.trim() || !billingAddress.trim() || !billingCity.trim() ||
        !billingState.trim() || !billingZip.trim()) {
      setError('Please fill in all required fields');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error('Card element not found');
      }

      // Confirm SetupIntent
      const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(
        setupData.clientSecret,
        {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: billingName,
              address: {
                line1: billingAddress,
                city: billingCity,
                state: billingState,
                postal_code: billingZip,
                country: 'US',
              },
            },
          },
        }
      );

      if (stripeError) {
        throw new Error(stripeError.message);
      }

      if (setupIntent?.payment_method) {
        // Save payment method to our database
        await savePaymentMutation.mutateAsync(setupIntent.payment_method as string);
        // Create consent record
        await signConsentMutation.mutateAsync();
        onComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSkip = async () => {
    if (required) return;

    try {
      await skipCardMutation.mutateAsync();
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip');
    }
  };

  if (setupLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (setupError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to initialize payment form. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Credit Card Authorization</h2>
        <p className="text-gray-600 text-sm">
          {required
            ? 'Please provide a credit card to keep on file for copays and balances.'
            : 'You may provide a credit card to keep on file, or skip this step.'}
        </p>
      </div>

      {/* Authorization Text */}
      <div className="border rounded-lg">
        <ScrollArea className="h-[200px] p-4">
          <div className="prose prose-sm max-w-none whitespace-pre-wrap font-mono text-xs">
            {CREDIT_CARD_AUTHORIZATION_TEXT}
          </div>
        </ScrollArea>
      </div>

      {/* Acknowledgment */}
      <div className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
        <Checkbox
          id="hasRead"
          checked={hasRead}
          onCheckedChange={(checked) => setHasRead(checked === true)}
        />
        <Label htmlFor="hasRead" className="text-sm leading-relaxed cursor-pointer">
          I have read and agree to the Credit Card Authorization terms above. I authorize
          charges to my card as described.
        </Label>
      </div>

      {/* Billing Information */}
      <div className="space-y-4">
        <h3 className="font-medium">Billing Information</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="billingName">Name on Card *</Label>
            <Input
              id="billingName"
              placeholder="Full name as it appears on card"
              value={billingName}
              onChange={(e) => setBillingName(e.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="billingAddress">Billing Address *</Label>
            <Input
              id="billingAddress"
              placeholder="Street address"
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="billingCity">City *</Label>
            <Input
              id="billingCity"
              placeholder="City"
              value={billingCity}
              onChange={(e) => setBillingCity(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="billingState">State *</Label>
              <Input
                id="billingState"
                placeholder="ST"
                maxLength={2}
                value={billingState}
                onChange={(e) => setBillingState(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="billingZip">ZIP Code *</Label>
              <Input
                id="billingZip"
                placeholder="12345"
                maxLength={10}
                value={billingZip}
                onChange={(e) => setBillingZip(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Card Element */}
      <div className="space-y-2">
        <Label>Card Information *</Label>
        <div className="border rounded-md p-3 bg-white">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: '#424770',
                  '::placeholder': {
                    color: '#aab7c4',
                  },
                },
                invalid: {
                  color: '#9e2146',
                },
              },
            }}
          />
        </div>
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <CreditCard className="h-3 w-3" />
          Your card information is securely processed by Stripe.
        </p>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between">
        {!required && (
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={isProcessing || skipCardMutation.isPending}
          >
            {skipCardMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Skipping...
              </>
            ) : (
              <>
                <SkipForward className="h-4 w-4 mr-2" />
                Skip for Now
              </>
            )}
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          disabled={!stripe || !hasRead || isProcessing}
          className={!required ? '' : 'ml-auto'}
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <CreditCard className="h-4 w-4 mr-2" />
              Save Card & Continue
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export function CreditCardAuthStep({
  portalToken,
  required,
  completed,
  skipped,
  onComplete,
}: CreditCardAuthStepProps) {
  if (completed) {
    return (
      <div className="text-center py-8">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Card on File</h2>
        <p className="text-gray-600">
          Your payment method has been securely saved.
        </p>
        <Button className="mt-4" onClick={onComplete}>
          Continue to Next Step
        </Button>
      </div>
    );
  }

  if (skipped) {
    return (
      <div className="text-center py-8">
        <SkipForward className="h-16 w-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Card Authorization Skipped</h2>
        <p className="text-gray-600">
          You chose to skip adding a card on file. You can add one later.
        </p>
        <Button className="mt-4" onClick={onComplete}>
          Continue to Next Step
        </Button>
      </div>
    );
  }

  // If Stripe isn't configured, show a message
  if (!import.meta.env.VITE_STRIPE_PUBLIC_KEY) {
    return (
      <div className="text-center py-8">
        <CreditCard className="h-16 w-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Credit Card Authorization</h2>
        <p className="text-gray-600 mb-4">
          Online card collection is not yet configured. Please provide your card information at your first visit.
        </p>
        {!required && (
          <Button onClick={onComplete}>
            <SkipForward className="h-4 w-4 mr-2" />
            Skip for Now
          </Button>
        )}
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <CreditCardForm
        portalToken={portalToken}
        required={required}
        onComplete={onComplete}
      />
    </Elements>
  );
}

export default CreditCardAuthStep;
