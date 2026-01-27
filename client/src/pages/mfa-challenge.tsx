import { useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getAuthHeaders } from '@/hooks/useAuth';

export default function MfaChallenge() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const headers = await getAuthHeaders();
      const body = useBackup ? { backupCode } : { token };
      const userId = new URLSearchParams(window.location.search).get('userId');

      const response = await fetch('/api/mfa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ ...body, userId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Verification failed');
      }

      setLocation('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>
            {useBackup
              ? 'Enter one of your backup codes'
              : 'Enter the 6-digit code from your authenticator app'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {useBackup ? (
              <div>
                <Label htmlFor="backupCode">Backup Code</Label>
                <Input
                  id="backupCode"
                  type="text"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value)}
                  placeholder="Enter 8-character backup code"
                  maxLength={8}
                  className="font-mono text-center text-lg tracking-widest"
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="token">Authentication Code</Label>
                <Input
                  id="token"
                  type="text"
                  inputMode="numeric"
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="font-mono text-center text-2xl tracking-widest"
                  autoFocus
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Verifying...' : 'Verify'}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setUseBackup(!useBackup);
                setError('');
              }}
            >
              {useBackup ? 'Use authenticator app instead' : 'Use a backup code instead'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
