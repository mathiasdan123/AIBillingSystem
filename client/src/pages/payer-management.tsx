import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getAuthHeaders } from '@/hooks/useAuth';

export default function PayerManagement() {
  const queryClient = useQueryClient();
  const [stediApiKey, setStediApiKey] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  const { data: integrations, isLoading } = useQuery({
    queryKey: ['/api/admin/payer-integrations'],
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: { payerName: string; apiKey: string }) => {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/payer-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to save');
      return res.json();
    },
    onSuccess: () => {
      setSaveMessage('Credentials saved successfully');
      setStediApiKey('');
      queryClient.invalidateQueries({ queryKey: ['/api/admin/payer-integrations'] });
    },
  });

  const healthCheckMutation = useMutation({
    mutationFn: async (payerName: string) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/payer-integrations/${payerName}/health-check`, {
        method: 'POST',
        headers: { ...headers },
      });
      if (!res.ok) throw new Error('Health check failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/payer-integrations'] });
    },
  });

  const healthBadge = (status: string) => {
    switch (status) {
      case 'healthy': return <Badge className="bg-green-100 text-green-800">Healthy</Badge>;
      case 'degraded': return <Badge className="bg-yellow-100 text-yellow-800">Degraded</Badge>;
      case 'down': return <Badge className="bg-red-100 text-red-800">Down</Badge>;
      default: return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payer Integration Management</h1>
        <p className="text-muted-foreground">Configure and monitor insurance payer connections</p>
      </div>

      {saveMessage && (
        <Alert>
          <AlertDescription>{saveMessage}</AlertDescription>
        </Alert>
      )}

      {/* Configure Stedi */}
      <Card>
        <CardHeader>
          <CardTitle>Stedi Configuration</CardTitle>
          <CardDescription>
            Configure your Stedi API key for real-time insurance eligibility verification
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="stediKey">Stedi API Key</Label>
            <Input
              id="stediKey"
              type="password"
              value={stediApiKey}
              onChange={(e) => setStediApiKey(e.target.value)}
              placeholder="Enter Stedi API key"
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => saveMutation.mutate({ payerName: 'stedi', apiKey: stediApiKey })}
              disabled={!stediApiKey || saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Credentials'}
            </Button>
            <Button
              variant="outline"
              onClick={() => healthCheckMutation.mutate('stedi')}
              disabled={healthCheckMutation.isPending}
            >
              {healthCheckMutation.isPending ? 'Testing...' : 'Test Connection'}
            </Button>
          </div>
          {healthCheckMutation.data && (
            <p className={`text-sm ${healthCheckMutation.data.healthy ? 'text-green-600' : 'text-red-600'}`}>
              {healthCheckMutation.data.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Active Integrations */}
      <Card>
        <CardHeader>
          <CardTitle>Active Integrations</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !integrations || (integrations as any[]).length === 0 ? (
            <p className="text-muted-foreground">No payer integrations configured yet.</p>
          ) : (
            <div className="space-y-3">
              {(integrations as any[]).map((integration: any) => (
                <div key={integration.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium capitalize">{integration.payerName}</p>
                    <p className="text-xs text-muted-foreground">
                      Last checked: {integration.lastHealthCheck
                        ? new Date(integration.lastHealthCheck).toLocaleString()
                        : 'Never'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {healthBadge(integration.healthStatus)}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => healthCheckMutation.mutate(integration.payerName)}
                    >
                      Check
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
