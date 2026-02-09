import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  CreditCard, CheckCircle, DollarSign, Calendar,
  Shield, Loader2, Plus
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Initialize Stripe
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY || '');

interface BillingInfo {
  plan: string;
  planName: string;
  percentage: number;
  features: string[];
  hasPaymentMethod: boolean;
  trialEndsAt: string | null;
  isInTrial: boolean;
}

interface PaymentMethod {
  id: string;
  card?: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
}

interface PaymentHistory {
  id: string;
  amount: number;
  status: string;
  description: string;
  created: string;
}

// Card Form Component - must be inside Elements provider
function CardForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setCardError(null);

    try {
      // Get setup intent from server
      const res = await apiRequest('POST', '/api/billing/setup-intent', {});
      const { clientSecret } = await res.json();

      // Confirm card setup
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error('Card element not found');
      }

      const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: {
          card: cardElement,
        },
      });

      if (error) {
        setCardError(error.message || 'Failed to add card');
      } else if (setupIntent?.status === 'succeeded') {
        // Set this as the default payment method
        await apiRequest('POST', '/api/billing/set-default-payment-method', {
          paymentMethodId: setupIntent.payment_method,
        });

        toast({
          title: 'Success',
          description: 'Payment method added successfully',
        });

        queryClient.invalidateQueries({ queryKey: ['/api/billing/payment-methods'] });
        queryClient.invalidateQueries({ queryKey: ['/api/billing/info'] });
        onSuccess();
      }
    } catch (error: any) {
      setCardError(error.message || 'Failed to add payment method');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="p-4 border rounded-lg bg-white">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: '16px',
                color: '#1e293b',
                '::placeholder': {
                  color: '#94a3b8',
                },
                fontFamily: 'system-ui, -apple-system, sans-serif',
              },
              invalid: {
                color: '#ef4444',
              },
            },
          }}
          onChange={(e) => {
            if (e.error) {
              setCardError(e.error.message);
            } else {
              setCardError(null);
            }
          }}
        />
      </div>

      {cardError && (
        <p className="text-sm text-red-500">{cardError}</p>
      )}

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Shield className="w-4 h-4" />
        <span>Your payment info is encrypted and secure</span>
      </div>

      <div className="flex gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isProcessing}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!stripe || isProcessing}
          className="flex-1"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Adding...
            </>
          ) : (
            'Add Card'
          )}
        </Button>
      </div>
    </form>
  );
}

export default function Billing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddCard, setShowAddCard] = useState(false);

  // Fetch billing info
  const { data: billingInfo, isLoading: billingLoading } = useQuery<BillingInfo>({
    queryKey: ['/api/billing/info'],
  });

  // Fetch payment methods
  const { data: paymentMethodsData, isLoading: methodsLoading } = useQuery<{ paymentMethods: PaymentMethod[] }>({
    queryKey: ['/api/billing/payment-methods'],
  });

  // Fetch payment history
  const { data: historyData, isLoading: historyLoading } = useQuery<{ payments: PaymentHistory[] }>({
    queryKey: ['/api/billing/history'],
  });

  // Set default payment method
  const setDefaultMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const res = await apiRequest('POST', '/api/billing/set-default-payment-method', {
        paymentMethodId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/billing/payment-methods'] });
      queryClient.invalidateQueries({ queryKey: ['/api/billing/info'] });
      toast({ title: 'Success', description: 'Default payment method updated' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update payment method', variant: 'destructive' });
    },
  });

  const plans = [
    {
      id: 'solo',
      name: 'Solo Practice',
      percentage: 5,
      features: ['Up to 100 patients', 'All core features', 'Email support'],
      recommended: false,
    },
    {
      id: 'growing',
      name: 'Growing Practice',
      percentage: 4.5,
      features: ['Unlimited patients', 'Multiple providers', 'Priority support', 'Advanced analytics'],
      recommended: true,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      percentage: null,
      features: ['Multi-location support', 'Custom integrations', 'Dedicated success manager', 'SLA guarantee'],
      recommended: false,
    },
  ];

  if (billingLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Billing & Subscription</h1>
        <p className="text-slate-600">Manage your subscription and payment methods</p>
      </div>

      {/* Current Plan */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                Current Plan
              </CardTitle>
              <CardDescription>Your subscription details</CardDescription>
            </div>
            {billingInfo?.isInTrial && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                Trial - {billingInfo.trialEndsAt ? new Date(billingInfo.trialEndsAt).toLocaleDateString() : 'Active'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg mb-4">
            <div>
              <h3 className="text-xl font-bold text-slate-900">{billingInfo?.planName || 'Growing Practice'}</h3>
              <p className="text-slate-600">
                {billingInfo?.percentage}% of collections
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-600">
                {billingInfo?.percentage || 4.5}%
              </div>
              <p className="text-sm text-slate-500">per collection</p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium text-slate-900">Plan Features:</h4>
            <ul className="grid grid-cols-2 gap-2">
              {billingInfo?.features?.map((feature, i) => (
                <li key={i} className="flex items-center text-sm text-slate-600">
                  <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Payment Methods */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-slate-600" />
                Payment Methods
              </CardTitle>
              <CardDescription>Manage your payment methods</CardDescription>
            </div>
            <Dialog open={showAddCard} onOpenChange={setShowAddCard}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Card
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Payment Method</DialogTitle>
                  <DialogDescription>
                    Add a credit or debit card for automatic billing
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <Elements stripe={stripePromise}>
                    <CardForm
                      onSuccess={() => setShowAddCard(false)}
                      onCancel={() => setShowAddCard(false)}
                    />
                  </Elements>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {methodsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : paymentMethodsData?.paymentMethods?.length ? (
            <div className="space-y-3">
              {paymentMethodsData.paymentMethods.map((pm) => (
                <div
                  key={pm.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-8 h-8 text-slate-400" />
                    <div>
                      <p className="font-medium text-slate-900 capitalize">
                        {pm.card?.brand} •••• {pm.card?.last4}
                      </p>
                      <p className="text-sm text-slate-500">
                        Expires {pm.card?.exp_month}/{pm.card?.exp_year}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDefaultMutation.mutate(pm.id)}
                    disabled={setDefaultMutation.isPending}
                  >
                    Set as Default
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <CreditCard className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p>No payment methods on file</p>
              <p className="text-sm">Add a payment method to enable automatic billing</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-600" />
            Payment History
          </CardTitle>
          <CardDescription>Your recent payments</CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : historyData?.payments?.length ? (
            <div className="space-y-3">
              {historyData.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <p className="font-medium text-slate-900">{payment.description || 'Monthly billing fee'}</p>
                    <p className="text-sm text-slate-500">
                      {new Date(payment.created).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-900">${payment.amount.toFixed(2)}</p>
                    <Badge
                      variant={payment.status === 'succeeded' ? 'default' : 'destructive'}
                      className={payment.status === 'succeeded' ? 'bg-green-100 text-green-800' : ''}
                    >
                      {payment.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p>No payment history yet</p>
              <p className="text-sm">Payments will appear here after your first billing cycle</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Compare Plans</CardTitle>
          <CardDescription>Choose the plan that fits your practice</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`p-4 rounded-lg border-2 ${
                  plan.recommended ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
                } ${billingInfo?.plan === plan.id ? 'ring-2 ring-blue-500' : ''}`}
              >
                {plan.recommended && (
                  <Badge className="mb-2 bg-blue-500">Recommended</Badge>
                )}
                <h3 className="font-bold text-lg text-slate-900">{plan.name}</h3>
                <p className="text-2xl font-bold text-slate-900 my-2">
                  {plan.percentage ? `${plan.percentage}%` : 'Custom'}
                </p>
                <p className="text-sm text-slate-500 mb-4">of collections</p>
                <ul className="space-y-2 text-sm">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center text-slate-600">
                      <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                {billingInfo?.plan === plan.id ? (
                  <Button className="w-full mt-4" disabled variant="outline">
                    Current Plan
                  </Button>
                ) : (
                  <Button className="w-full mt-4" variant={plan.recommended ? 'default' : 'outline'}>
                    {plan.percentage ? 'Switch Plan' : 'Contact Sales'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
