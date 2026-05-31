import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { CheckCircle2, AlertTriangle, Search, ShieldCheck, Building2 } from 'lucide-react';
import PageLayout from '@/components/PageLayout';

/**
 * Provider Profile & Enrollment Identity (Phases 1-2).
 *
 * Captures the billing-provider identity required before any live claim or
 * ERA enrollment, validates the NPI (with NPPES lookup), records the
 * enrollment authorization, and creates the practice's Stedi provider
 * record. The readiness checklist tells the practice exactly what's missing.
 */

interface Readiness {
  complete: boolean;
  npiValid: boolean;
  authorized: boolean;
  hasStediProvider: boolean;
  missing: string[];
}

interface ProfileResponse {
  name: string | null;
  npi: string | null;
  npiType: string | null;
  taxIdMasked: string | null;
  taxIdPresent: boolean;
  taxonomyCode: string | null;
  address: { street: string | null; city: string | null; state: string | null; zip: string | null; legacy: string | null };
  billingContact: { name: string | null; email: string | null; phone: string | null };
  enrollmentNotificationEmail: string | null;
  owner: { name: string | null; title: string | null };
  enrollmentAuthorizedAt: string | null;
  stediProviderId: string | null;
  readiness: Readiness;
}

export default function ProviderProfilePage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<ProfileResponse>({
    queryKey: ['/api/provider-profile'],
    queryFn: async () => (await apiRequest('GET', '/api/provider-profile')).json(),
  });

  const [form, setForm] = useState({
    name: '', npi: '', npiType: '', taxId: '', taxonomyCode: '',
    street: '', city: '', state: '', zip: '',
    contactName: '', contactEmail: '', contactPhone: '',
    notificationEmail: '',
  });
  const [auth, setAuth] = useState({ ownerName: '', ownerTitle: '', ownerSignature: '' });
  const [nppes, setNppes] = useState<string | null>(null);

  // Hydrate the form once the profile loads.
  useEffect(() => {
    if (!data) return;
    setForm({
      name: data.name ?? '',
      npi: data.npi ?? '',
      npiType: data.npiType ?? '',
      taxId: '',
      taxonomyCode: data.taxonomyCode ?? '',
      street: data.address?.street ?? '',
      city: data.address?.city ?? '',
      state: data.address?.state ?? '',
      zip: data.address?.zip ?? '',
      contactName: data.billingContact?.name ?? '',
      contactEmail: data.billingContact?.email ?? '',
      contactPhone: data.billingContact?.phone ?? '',
      notificationEmail: data.enrollmentNotificationEmail ?? '',
    });
    setAuth((a) => ({ ...a, ownerName: data.owner?.name ?? a.ownerName, ownerTitle: data.owner?.title ?? a.ownerTitle }));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        name: form.name,
        npi: form.npi,
        npiType: form.npiType || null,
        taxonomyCode: form.taxonomyCode || null,
        address: { street: form.street, city: form.city, state: form.state, zip: form.zip },
        billingContact: { name: form.contactName, email: form.contactEmail, phone: form.contactPhone },
        enrollmentNotificationEmail: form.notificationEmail || null,
      };
      if (form.taxId.trim()) body.taxId = form.taxId.trim();
      return (await apiRequest('PUT', '/api/provider-profile', body)).json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/provider-profile'] });
      toast({ title: 'Profile saved' });
      setForm((f) => ({ ...f, taxId: '' }));
    },
    onError: (e: any) => toast({ title: 'Save failed', description: e?.message || 'Check the fields and try again.', variant: 'destructive' }),
  });

  const lookupMutation = useMutation({
    mutationFn: async () => (await apiRequest('GET', `/api/provider-profile/npi-lookup?npi=${encodeURIComponent(form.npi)}`)).json(),
    onSuccess: (r: any) => {
      if (!r?.found) {
        setNppes(`Not found in NPPES (${r?.error || 'unknown'})`);
        return;
      }
      setNppes(`✓ ${r.name}${r.address?.city ? ` — ${r.address.city}, ${r.address.state}` : ''}`);
      // Offer the registry values as autofill.
      setForm((f) => ({
        ...f,
        name: f.name || r.name || '',
        npiType: f.npiType || (r.enumerationType === 'NPI-2' ? 'organization' : 'individual'),
        taxonomyCode: f.taxonomyCode || r.taxonomyCode || '',
        street: f.street || r.address?.street || '',
        city: f.city || r.address?.city || '',
        state: f.state || r.address?.state || '',
        zip: f.zip || r.address?.zip || '',
      }));
    },
    onError: () => setNppes('Lookup failed'),
  });

  const authorizeMutation = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/provider-profile/authorize', auth)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/provider-profile'] });
      toast({ title: 'Enrollment authorized' });
    },
    onError: (e: any) => toast({ title: 'Authorization failed', description: e?.message, variant: 'destructive' }),
  });

  const createProviderMutation = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/provider-profile/stedi-provider')).json(),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['/api/provider-profile'] });
      toast({ title: 'Stedi provider record created', description: `ID: ${r?.stediProviderId ?? '—'}` });
    },
    onError: (e: any) => toast({ title: 'Could not create provider record', description: e?.message || 'See readiness checklist.', variant: 'destructive' }),
  });

  const readiness = data?.readiness;

  return (
    <PageLayout
      title="Provider Profile & Enrollment"
      description="Your billing identity (NPI, Tax ID, address) and authorization. This must be complete before submitting payer enrollments or live claims."
      isLoading={isLoading}
    >
      {/* Readiness checklist */}
      {readiness && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {readiness.complete ? (
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              )}
              Enrollment readiness
            </CardTitle>
            <CardDescription>
              {readiness.complete
                ? 'Profile complete. You can create the Stedi provider record below.'
                : `${readiness.missing.length} item(s) still needed before you can enroll.`}
            </CardDescription>
          </CardHeader>
          {!readiness.complete && (
            <CardContent>
              <ul className="text-sm space-y-1">
                {readiness.missing.map((m) => (
                  <li key={m} className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {m}
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      {/* Identity form */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> Billing provider identity</CardTitle>
          <CardDescription>As registered with NPPES and your payers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Legal / billing name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Therapy LLC" />
            </Field>
            <Field label="Provider type">
              <Select value={form.npiType} onValueChange={(v) => setForm({ ...form, npiType: v })}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="organization">Organization (Type 2)</SelectItem>
                  <SelectItem value="individual">Individual (Type 1)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="NPI">
              <div className="flex gap-2">
                <Input value={form.npi} onChange={(e) => { setForm({ ...form, npi: e.target.value }); setNppes(null); }} placeholder="10-digit NPI" />
                <Button type="button" variant="outline" onClick={() => lookupMutation.mutate()} disabled={!form.npi || lookupMutation.isPending}>
                  <Search className="w-4 h-4 mr-1" /> Look up
                </Button>
              </div>
              {nppes && <p className="text-xs mt-1 text-muted-foreground">{nppes}</p>}
            </Field>
            <Field label={`Tax ID (EIN/SSN)${data?.taxIdPresent ? ` — saved ${data.taxIdMasked}` : ''}`}>
              <Input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} placeholder={data?.taxIdPresent ? 'Enter new to replace' : '9 digits'} />
            </Field>
          </div>
          <Field label="Taxonomy code">
            <Input value={form.taxonomyCode} onChange={(e) => setForm({ ...form, taxonomyCode: e.target.value })} placeholder="e.g. 225X00000X" />
          </Field>

          <div className="pt-2 border-t">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Billing address</Label>
            <div className="grid md:grid-cols-2 gap-4 mt-2">
              <Field label="Street"><Input value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} /></Field>
              <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
              <Field label="State (2-letter)"><Input value={form.state} maxLength={2} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} /></Field>
              <Field label="ZIP"><Input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} /></Field>
            </div>
          </div>

          <div className="pt-2 border-t">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Billing contact</Label>
            <div className="grid md:grid-cols-3 gap-4 mt-2">
              <Field label="Name"><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
              <Field label="Email"><Input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
              <Field label="Phone"><Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></Field>
            </div>
            <div className="mt-4">
              <Field label="Enrollment notification email (where Stedi sends status updates)">
                <Input value={form.notificationEmail} onChange={(e) => setForm({ ...form, notificationEmail: e.target.value })} placeholder="Defaults to billing contact email" />
              </Field>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
              {saveMutation.isPending ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Authorization */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Enrollment authorization</CardTitle>
          <CardDescription>
            Authorize TherapyBill to submit payer enrollments on your behalf. Required once before any enrollment.
            {data?.enrollmentAuthorizedAt && (
              <span className="block mt-1 text-green-700 dark:text-green-300">✓ Authorized {new Date(data.enrollmentAuthorizedAt).toLocaleDateString()}</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Authorized signer name"><Input value={auth.ownerName} onChange={(e) => setAuth({ ...auth, ownerName: e.target.value })} /></Field>
            <Field label="Title"><Input value={auth.ownerTitle} onChange={(e) => setAuth({ ...auth, ownerTitle: e.target.value })} placeholder="e.g. Owner, Administrator" /></Field>
          </div>
          <Field label="Typed signature">
            <Input value={auth.ownerSignature} onChange={(e) => setAuth({ ...auth, ownerSignature: e.target.value })} placeholder="Type your full name to sign" />
          </Field>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => authorizeMutation.mutate()} disabled={authorizeMutation.isPending || !auth.ownerName || !auth.ownerSignature}>
              {authorizeMutation.isPending ? 'Recording…' : data?.enrollmentAuthorizedAt ? 'Re-authorize' : 'Authorize enrollment'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stedi provider record */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stedi provider record</CardTitle>
          <CardDescription>
            {data?.stediProviderId
              ? `Created. ID: ${data.stediProviderId}`
              : 'Creates your provider record in our Stedi account. Required before submitting enrollments.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => createProviderMutation.mutate()}
            disabled={createProviderMutation.isPending || !readiness?.complete}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {createProviderMutation.isPending ? 'Creating…' : data?.stediProviderId ? 'Refresh provider record' : 'Create Stedi provider record'}
          </Button>
          {!readiness?.complete && (
            <p className="text-xs text-amber-600 mt-2">Complete the profile above first.</p>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-sm">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
