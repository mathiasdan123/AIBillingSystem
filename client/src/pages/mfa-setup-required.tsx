/**
 * MFA Setup Required page
 *
 * Shown when a user is authenticated but has not yet enabled MFA. The
 * server's mfaSetupRequired middleware blocks PHI access for these
 * users, so without a client-side gate the dashboard fires 13+ parallel
 * API calls that all return 403 — generating spurious "high forbidden
 * access" alarms. This page is the gate: a single, focused next-step
 * UX that lets the user enable MFA, then routes them to the dashboard.
 */
import MfaEnrollmentSecret from "@/components/MfaEnrollmentSecret";
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, KeyRound, LogOut } from 'lucide-react';
import { getAuthHeaders } from '@/hooks/useAuth';
import { clearSensitiveStorage } from '@/lib/clearSensitiveStorage';

interface MfaSetupResponse {
  uri: string;
  backupCodes: string[];
}

export default function MfaSetupRequired() {
  const queryClient = useQueryClient();
  const [setupData, setSetupData] = useState<MfaSetupResponse | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const setupMutation = useMutation({
    mutationFn: async (): Promise<MfaSetupResponse> => {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/mfa/setup', { method: 'POST', headers });
      if (!res.ok) throw new Error('Could not start MFA setup. Please try again.');
      return res.json();
    },
    onSuccess: (data) => {
      setSetupData(data);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const verifyMutation = useMutation({
    mutationFn: async (code: string) => {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ token: code }),
      });
      if (!res.ok) throw new Error('Invalid code. Check your authenticator and try again.');
      return res.json();
    },
    onSuccess: () => {
      // Refresh auth state so the App-level gate (App.tsx checks
      // needsMfaSetup from useAuth) releases and the user lands on
      // the dashboard. No manual navigation needed — useAuth will
      // refetch on the next mount and mfaRequired will be false.
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-6 w-6" />
            <CardTitle>Set Up Two-Factor Authentication</CardTitle>
          </div>
          <CardDescription>
            For HIPAA compliance, MFA is required before you can access patient
            data. This is a one-time setup that takes about a minute.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!setupData ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                You'll need an authenticator app (Google Authenticator, Authy, 1Password, etc.).
                Install one on your phone if you don't have one yet.
              </p>
              <Button
                onClick={() => setupMutation.mutate()}
                disabled={setupMutation.isPending}
                className="w-full"
                data-testid="button-start-mfa-setup"
              >
                <KeyRound className="h-4 w-4 mr-2" />
                {setupMutation.isPending ? 'Starting…' : 'Begin setup'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-800 mb-1">
                  Step 1 — Add to your authenticator
                </p>
                <MfaEnrollmentSecret uri={setupData.uri} />
              </div>

              <div>
                <p className="text-sm font-medium text-slate-800 mb-1">
                  Step 2 — Save your backup codes
                </p>
                <p className="text-xs text-slate-600 mb-2">
                  Store these somewhere safe. Each code works once if you lose your phone.
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {setupData.backupCodes.map((code, i) => (
                    <code
                      key={i}
                      className="text-xs bg-slate-100 p-1 rounded text-center font-mono"
                    >
                      {code}
                    </code>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-800 mb-1">
                  Step 3 — Enter the 6-digit code from your authenticator
                </p>
                <div className="flex gap-2">
                  <Input
                    value={token}
                    onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    className="font-mono"
                    data-testid="input-mfa-token"
                  />
                  <Button
                    onClick={() => verifyMutation.mutate(token)}
                    disabled={token.length !== 6 || verifyMutation.isPending}
                    data-testid="button-verify-mfa"
                  >
                    {verifyMutation.isPending ? 'Verifying…' : 'Verify & continue'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* This screen replaces the whole app (App.tsx gate), so without
              this there is no way to sign out -- a trap on a shared machine,
              and confusing for someone who did not expect to still be signed
              in. Same logout path as the sidebar menu. */}
          <div className="pt-2 border-t text-center">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 underline-offset-4 hover:underline"
              onClick={() => { clearSensitiveStorage(); window.location.href = '/api/logout'; }}
              data-testid="button-mfa-setup-sign-out"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Not you? Sign out
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
