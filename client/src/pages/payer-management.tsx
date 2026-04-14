import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getAuthHeaders } from '@/hooks/useAuth';

interface CrosswalkEntry {
  id: number;
  parentPayerName: string;
  subPlanName: string;
  subPlanKeywords: string[];
  tradingPartnerId: string;
  stediPayerId: string | null;
  state: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function PayerManagement() {
  const queryClient = useQueryClient();
  const [stediApiKey, setStediApiKey] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  // Crosswalk state
  const [crosswalkSearch, setCrosswalkSearch] = useState('');
  const [showCrosswalkForm, setShowCrosswalkForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CrosswalkEntry | null>(null);
  const [crosswalkForm, setCrosswalkForm] = useState({
    parentPayerName: '',
    subPlanName: '',
    subPlanKeywords: '',
    tradingPartnerId: '',
    stediPayerId: '',
    state: '',
    notes: '',
    isActive: true,
  });

  const { data: integrations, isLoading } = useQuery({
    queryKey: ['/api/admin/payer-integrations'],
    retry: false,
  });

  const { data: crosswalkEntries, isLoading: crosswalkLoading } = useQuery<CrosswalkEntry[]>({
    queryKey: ['/api/admin/payer-crosswalk', crosswalkSearch],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const params = crosswalkSearch ? `?search=${encodeURIComponent(crosswalkSearch)}` : '';
      const res = await fetch(`/api/admin/payer-crosswalk${params}`, { headers });
      if (!res.ok) throw new Error('Failed to fetch crosswalk');
      return res.json();
    },
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

  const createCrosswalkMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/admin/payer-crosswalk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create crosswalk entry');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/payer-crosswalk'] });
      resetCrosswalkForm();
    },
  });

  const updateCrosswalkMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/payer-crosswalk/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update crosswalk entry');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/payer-crosswalk'] });
      resetCrosswalkForm();
    },
  });

  const deleteCrosswalkMutation = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/payer-crosswalk/${id}`, {
        method: 'DELETE',
        headers: { ...headers },
      });
      if (!res.ok) throw new Error('Failed to delete crosswalk entry');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/payer-crosswalk'] });
    },
  });

  const resetCrosswalkForm = () => {
    setCrosswalkForm({
      parentPayerName: '',
      subPlanName: '',
      subPlanKeywords: '',
      tradingPartnerId: '',
      stediPayerId: '',
      state: '',
      notes: '',
      isActive: true,
    });
    setEditingEntry(null);
    setShowCrosswalkForm(false);
  };

  const handleEditCrosswalk = (entry: CrosswalkEntry) => {
    setEditingEntry(entry);
    setCrosswalkForm({
      parentPayerName: entry.parentPayerName,
      subPlanName: entry.subPlanName,
      subPlanKeywords: (entry.subPlanKeywords || []).join(', '),
      tradingPartnerId: entry.tradingPartnerId,
      stediPayerId: entry.stediPayerId || '',
      state: entry.state || '',
      notes: entry.notes || '',
      isActive: entry.isActive,
    });
    setShowCrosswalkForm(true);
  };

  const handleSaveCrosswalk = () => {
    const data = {
      parentPayerName: crosswalkForm.parentPayerName,
      subPlanName: crosswalkForm.subPlanName,
      subPlanKeywords: crosswalkForm.subPlanKeywords
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
      tradingPartnerId: crosswalkForm.tradingPartnerId,
      stediPayerId: crosswalkForm.stediPayerId || null,
      state: crosswalkForm.state || null,
      notes: crosswalkForm.notes || null,
      isActive: crosswalkForm.isActive,
    };

    if (editingEntry) {
      updateCrosswalkMutation.mutate({ id: editingEntry.id, data });
    } else {
      createCrosswalkMutation.mutate(data);
    }
  };

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

      {/* Payer Crosswalk / Sub-Plan Routing */}
      <Card>
        <CardHeader>
          <CardTitle>Payer Sub-Plan Routing (Crosswalk)</CardTitle>
          <CardDescription>
            Map insurance subsidiaries and sub-plans to the correct payer IDs for claim routing.
            When a patient's plan matches a sub-plan entry, claims are automatically routed to the correct trading partner.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search by payer name, sub-plan, or trading partner ID..."
              value={crosswalkSearch}
              onChange={(e) => setCrosswalkSearch(e.target.value)}
              className="max-w-md"
            />
            <Button onClick={() => { resetCrosswalkForm(); setShowCrosswalkForm(true); }}>
              Add Mapping
            </Button>
          </div>

          {/* Add/Edit Form */}
          {showCrosswalkForm && (
            <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
              <h3 className="font-medium">
                {editingEntry ? 'Edit Sub-Plan Mapping' : 'New Sub-Plan Mapping'}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Parent Payer Name</Label>
                  <Input
                    placeholder="e.g., Aetna"
                    value={crosswalkForm.parentPayerName}
                    onChange={(e) => setCrosswalkForm({ ...crosswalkForm, parentPayerName: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Sub-Plan Name</Label>
                  <Input
                    placeholder="e.g., Aetna Better Health"
                    value={crosswalkForm.subPlanName}
                    onChange={(e) => setCrosswalkForm({ ...crosswalkForm, subPlanName: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Trading Partner ID</Label>
                  <Input
                    placeholder="e.g., AETNABH"
                    value={crosswalkForm.tradingPartnerId}
                    onChange={(e) => setCrosswalkForm({ ...crosswalkForm, tradingPartnerId: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Stedi Payer ID (optional)</Label>
                  <Input
                    placeholder="e.g., AETBH01"
                    value={crosswalkForm.stediPayerId}
                    onChange={(e) => setCrosswalkForm({ ...crosswalkForm, stediPayerId: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Keywords (comma-separated)</Label>
                  <Input
                    placeholder="e.g., better health, medicaid"
                    value={crosswalkForm.subPlanKeywords}
                    onChange={(e) => setCrosswalkForm({ ...crosswalkForm, subPlanKeywords: e.target.value })}
                  />
                </div>
                <div>
                  <Label>State (optional)</Label>
                  <Input
                    placeholder="e.g., NJ"
                    value={crosswalkForm.state}
                    onChange={(e) => setCrosswalkForm({ ...crosswalkForm, state: e.target.value })}
                    maxLength={2}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Notes (optional)</Label>
                  <Input
                    placeholder="e.g., Aetna Medicaid managed care plan"
                    value={crosswalkForm.notes}
                    onChange={(e) => setCrosswalkForm({ ...crosswalkForm, notes: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="crosswalkActive"
                  checked={crosswalkForm.isActive}
                  onChange={(e) => setCrosswalkForm({ ...crosswalkForm, isActive: e.target.checked })}
                />
                <Label htmlFor="crosswalkActive">Active</Label>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSaveCrosswalk}
                  disabled={
                    !crosswalkForm.parentPayerName ||
                    !crosswalkForm.subPlanName ||
                    !crosswalkForm.tradingPartnerId ||
                    createCrosswalkMutation.isPending ||
                    updateCrosswalkMutation.isPending
                  }
                >
                  {(createCrosswalkMutation.isPending || updateCrosswalkMutation.isPending)
                    ? 'Saving...'
                    : editingEntry ? 'Update' : 'Create'}
                </Button>
                <Button variant="outline" onClick={resetCrosswalkForm}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Crosswalk Table */}
          {crosswalkLoading ? (
            <p className="text-muted-foreground">Loading crosswalk entries...</p>
          ) : !crosswalkEntries || crosswalkEntries.length === 0 ? (
            <p className="text-muted-foreground">
              No crosswalk entries found.{' '}
              {crosswalkSearch ? 'Try a different search term.' : 'Click "Add Mapping" to create one.'}
            </p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Parent Payer</th>
                    <th className="text-left p-3 font-medium">Sub-Plan</th>
                    <th className="text-left p-3 font-medium">Trading Partner ID</th>
                    <th className="text-left p-3 font-medium">Keywords</th>
                    <th className="text-left p-3 font-medium">State</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {crosswalkEntries.map((entry) => (
                    <tr key={entry.id} className="border-t hover:bg-muted/30">
                      <td className="p-3 font-medium">{entry.parentPayerName}</td>
                      <td className="p-3">{entry.subPlanName}</td>
                      <td className="p-3">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {entry.tradingPartnerId}
                        </code>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {(entry.subPlanKeywords || []).map((kw, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {kw}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-3">{entry.state || '-'}</td>
                      <td className="p-3">
                        <Badge className={entry.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                          {entry.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditCrosswalk(entry)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => {
                              if (confirm(`Delete sub-plan mapping "${entry.subPlanName}"?`)) {
                                deleteCrosswalkMutation.mutate(entry.id);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
