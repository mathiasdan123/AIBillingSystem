import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DollarSign, Plus, Trash2, Upload, Wand2, Loader2, Calculator,
  FileText, CheckCircle, AlertCircle, Users, Building2
} from "lucide-react";

interface InsuranceRate {
  id: number;
  insuranceProvider: string;
  cptCode: string;
  inNetworkRate: string | null;
  outOfNetworkRate: string | null;
  deductibleApplies: boolean;
  coinsurancePercent: string;
  copayAmount: string | null;
}

interface CostEstimate {
  patient: {
    id: number;
    name: string;
    insurance: string;
  };
  estimatedInsurancePayment: number;
  estimatedPatientResponsibility: number;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

export default function InsuranceRates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showParseDialog, setShowParseDialog] = useState(false);
  const [contractText, setContractText] = useState("");
  const [parseProvider, setParseProvider] = useState("");
  const [parseResult, setParseResult] = useState<any>(null);

  // New rate form state
  const [newRate, setNewRate] = useState({
    insuranceProvider: "",
    cptCode: "",
    inNetworkRate: "",
    outOfNetworkRate: "",
    deductibleApplies: true,
    coinsurancePercent: "20",
    copayAmount: "",
  });

  // Queries
  const { data: rates, isLoading: ratesLoading } = useQuery<InsuranceRate[]>({
    queryKey: ['/api/insurance-rates', selectedProvider],
    queryFn: async () => {
      const url = selectedProvider
        ? `/api/insurance-rates?provider=${encodeURIComponent(selectedProvider)}`
        : '/api/insurance-rates';
      const res = await fetch(url, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: providers } = useQuery<string[]>({
    queryKey: ['/api/insurance-rates/providers'],
  });

  const { data: patients } = useQuery<any[]>({
    queryKey: ['/api/patients?practiceId=1'],
  });

  const { data: cptCodes } = useQuery<any[]>({
    queryKey: ['/api/cpt-codes'],
  });

  // Mutations
  const saveRateMutation = useMutation({
    mutationFn: async (rate: any) => {
      const res = await apiRequest("POST", "/api/insurance-rates", rate);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurance-rates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/insurance-rates/providers'] });
      toast({ title: "Rate Saved", description: "Insurance rate saved successfully" });
      setShowAddDialog(false);
      setNewRate({
        insuranceProvider: "",
        cptCode: "",
        inNetworkRate: "",
        outOfNetworkRate: "",
        deductibleApplies: true,
        coinsurancePercent: "20",
        copayAmount: "",
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save rate", variant: "destructive" });
    },
  });

  const deleteRateMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/insurance-rates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurance-rates'] });
      toast({ title: "Deleted", description: "Rate removed" });
    },
  });

  const parseContractMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/insurance-rates/parse-contract", {
        contractText,
        insuranceProvider: parseProvider,
      });
      return res.json();
    },
    onSuccess: (result) => {
      setParseResult(result);
      toast({ title: "Contract Parsed", description: `Found ${result.rates.length} rates` });
    },
    onError: () => {
      toast({ title: "Parse Failed", description: "Could not parse contract", variant: "destructive" });
    },
  });

  const saveParsedRatesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/insurance-rates/save-parsed", parseResult);
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurance-rates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/insurance-rates/providers'] });
      toast({
        title: "Rates Saved",
        description: `Saved ${result.saved} rates from contract`,
      });
      setShowParseDialog(false);
      setContractText("");
      setParseResult(null);
    },
  });

  // Patient cost estimates
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const { data: patientEstimate, isLoading: estimateLoading } = useQuery<CostEstimate>({
    queryKey: ['/api/patients', selectedPatientId, 'cost-estimate'],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${selectedPatientId}/cost-estimate?sessionRate=300`, {
        credentials: 'include',
      });
      return res.json();
    },
    enabled: !!selectedPatientId,
  });

  const groupedRates = rates?.reduce((acc, rate) => {
    if (!acc[rate.insuranceProvider]) {
      acc[rate.insuranceProvider] = [];
    }
    acc[rate.insuranceProvider].push(rate);
    return acc;
  }, {} as Record<string, InsuranceRate[]>) || {};

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <DollarSign className="h-6 w-6" />
            Insurance Rates & Cost Estimation
          </h1>
          <p className="text-slate-600">
            Manage fee schedules and estimate patient out-of-pocket costs
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showParseDialog} onOpenChange={setShowParseDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Upload className="mr-2 h-4 w-4" />
                Parse Contract
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Parse Insurance Contract</DialogTitle>
                <DialogDescription>
                  Paste your insurance contract or fee schedule. AI will extract the rates.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Insurance Provider Name</Label>
                  <Input
                    value={parseProvider}
                    onChange={(e) => setParseProvider(e.target.value)}
                    placeholder="e.g., Blue Cross Blue Shield"
                  />
                </div>
                <div>
                  <Label>Contract Text / Fee Schedule</Label>
                  <Textarea
                    value={contractText}
                    onChange={(e) => setContractText(e.target.value)}
                    placeholder="Paste the contract text or fee schedule here..."
                    rows={10}
                  />
                </div>

                {!parseResult ? (
                  <Button
                    onClick={() => parseContractMutation.mutate()}
                    disabled={!contractText || !parseProvider || parseContractMutation.isPending}
                    className="w-full"
                  >
                    {parseContractMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Parsing with AI...
                      </>
                    ) : (
                      <>
                        <Wand2 className="mr-2 h-4 w-4" />
                        Parse Contract
                      </>
                    )}
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="p-4 bg-green-50 rounded-lg">
                      <h4 className="font-medium text-green-800 mb-2">
                        Found {parseResult.rates.length} Rates
                      </h4>
                      <div className="space-y-1 text-sm">
                        {parseResult.rates.map((rate: any, i: number) => (
                          <div key={i} className="flex justify-between">
                            <span>{rate.cptCode}</span>
                            <span>${rate.inNetworkRate || 'N/A'}</span>
                          </div>
                        ))}
                      </div>
                      {parseResult.parsingNotes?.length > 0 && (
                        <p className="text-xs text-green-600 mt-2">
                          Note: {parseResult.parsingNotes.join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setParseResult(null)}
                        className="flex-1"
                      >
                        Re-parse
                      </Button>
                      <Button
                        onClick={() => saveParsedRatesMutation.mutate()}
                        disabled={saveParsedRatesMutation.isPending}
                        className="flex-1"
                      >
                        {saveParsedRatesMutation.isPending ? "Saving..." : "Save Rates"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Rate
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Insurance Rate</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Insurance Provider</Label>
                  <Input
                    value={newRate.insuranceProvider}
                    onChange={(e) => setNewRate({ ...newRate, insuranceProvider: e.target.value })}
                    placeholder="e.g., Aetna, Blue Cross"
                  />
                </div>
                <div>
                  <Label>CPT Code</Label>
                  <Select
                    value={newRate.cptCode}
                    onValueChange={(v) => setNewRate({ ...newRate, cptCode: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select CPT code" />
                    </SelectTrigger>
                    <SelectContent>
                      {cptCodes?.map((cpt) => (
                        <SelectItem key={cpt.id} value={cpt.code}>
                          {cpt.code} - {cpt.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>In-Network Rate ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newRate.inNetworkRate}
                      onChange={(e) => setNewRate({ ...newRate, inNetworkRate: e.target.value })}
                      placeholder="85.00"
                    />
                  </div>
                  <div>
                    <Label>Out-of-Network Rate ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newRate.outOfNetworkRate}
                      onChange={(e) => setNewRate({ ...newRate, outOfNetworkRate: e.target.value })}
                      placeholder="60.00"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Coinsurance (%)</Label>
                    <Input
                      type="number"
                      value={newRate.coinsurancePercent}
                      onChange={(e) => setNewRate({ ...newRate, coinsurancePercent: e.target.value })}
                      placeholder="20"
                    />
                  </div>
                  <div>
                    <Label>Copay ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newRate.copayAmount}
                      onChange={(e) => setNewRate({ ...newRate, copayAmount: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="deductible"
                    checked={newRate.deductibleApplies}
                    onCheckedChange={(checked) =>
                      setNewRate({ ...newRate, deductibleApplies: checked as boolean })
                    }
                  />
                  <Label htmlFor="deductible">Deductible applies</Label>
                </div>
                <Button
                  onClick={() => saveRateMutation.mutate(newRate)}
                  disabled={!newRate.insuranceProvider || !newRate.cptCode || saveRateMutation.isPending}
                  className="w-full"
                >
                  {saveRateMutation.isPending ? "Saving..." : "Save Rate"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="rates">
        <TabsList>
          <TabsTrigger value="rates">
            <FileText className="h-4 w-4 mr-1" />
            Fee Schedules
          </TabsTrigger>
          <TabsTrigger value="estimate">
            <Calculator className="h-4 w-4 mr-1" />
            Cost Estimator
          </TabsTrigger>
        </TabsList>

        {/* Fee Schedules Tab */}
        <TabsContent value="rates" className="space-y-4 mt-4">
          {/* Filter */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-4">
                <Label>Filter by Insurance:</Label>
                <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="All providers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All providers</SelectItem>
                    {providers?.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProvider && (
                  <Button variant="ghost" size="sm" onClick={() => setSelectedProvider("")}>
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Rates Table */}
          {ratesLoading ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-slate-400" />
              </CardContent>
            </Card>
          ) : Object.keys(groupedRates).length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="h-12 w-12 mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-medium text-slate-700 mb-2">No Insurance Rates</h3>
                <p className="text-slate-500 mb-4">
                  Add rates manually or parse an insurance contract
                </p>
                <div className="flex justify-center gap-2">
                  <Button variant="outline" onClick={() => setShowParseDialog(true)}>
                    <Upload className="mr-2 h-4 w-4" />
                    Parse Contract
                  </Button>
                  <Button onClick={() => setShowAddDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Rate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            Object.entries(groupedRates).map(([provider, providerRates]) => (
              <Card key={provider}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {provider}
                  </CardTitle>
                  <CardDescription>{providerRates.length} rate(s) on file</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left p-2">CPT Code</th>
                          <th className="text-right p-2">In-Network</th>
                          <th className="text-right p-2">Out-of-Network</th>
                          <th className="text-center p-2">Coinsurance</th>
                          <th className="text-center p-2">Deductible</th>
                          <th className="text-right p-2">Copay</th>
                          <th className="text-center p-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {providerRates.map((rate) => (
                          <tr key={rate.id} className="border-t">
                            <td className="p-2">
                              <Badge variant="outline" className="font-mono">{rate.cptCode}</Badge>
                            </td>
                            <td className="p-2 text-right font-medium">
                              {rate.inNetworkRate ? `$${parseFloat(rate.inNetworkRate).toFixed(2)}` : '-'}
                            </td>
                            <td className="p-2 text-right text-slate-500">
                              {rate.outOfNetworkRate ? `$${parseFloat(rate.outOfNetworkRate).toFixed(2)}` : '-'}
                            </td>
                            <td className="p-2 text-center">
                              {rate.coinsurancePercent}%
                            </td>
                            <td className="p-2 text-center">
                              {rate.deductibleApplies ? (
                                <CheckCircle className="h-4 w-4 text-green-500 mx-auto" />
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="p-2 text-right">
                              {rate.copayAmount ? `$${parseFloat(rate.copayAmount).toFixed(2)}` : '-'}
                            </td>
                            <td className="p-2 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteRateMutation.mutate(rate.id)}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Cost Estimator Tab */}
        <TabsContent value="estimate" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Patient Selector */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Patient Cost Estimate
                </CardTitle>
                <CardDescription>
                  Select a patient to estimate their out-of-pocket cost
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Select Patient</Label>
                  <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a patient" />
                    </SelectTrigger>
                    <SelectContent>
                      {patients?.map((p) => (
                        <SelectItem key={p.id} value={p.id.toString()}>
                          {p.firstName} {p.lastName}
                          {p.insuranceProvider && (
                            <span className="text-slate-400 ml-2">({p.insuranceProvider})</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Your session rate:</strong> $300
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    This is the amount you charge. Insurance pays their contracted rate,
                    and the patient is responsible for the balance.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Estimate Result */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  Estimated Costs
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedPatientId ? (
                  <div className="text-center py-8 text-slate-500">
                    <Calculator className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p>Select a patient to see cost estimate</p>
                  </div>
                ) : estimateLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-slate-400" />
                  </div>
                ) : patientEstimate ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-600">Patient</p>
                      <p className="font-medium">{patientEstimate.patient.name}</p>
                      <p className="text-sm text-slate-500">{patientEstimate.patient.insurance}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-green-50 rounded-lg">
                        <p className="text-sm text-green-700">Insurance Pays</p>
                        <p className="text-2xl font-bold text-green-800">
                          ${patientEstimate.estimatedInsurancePayment.toFixed(2)}
                        </p>
                      </div>
                      <div className="p-4 bg-amber-50 rounded-lg">
                        <p className="text-sm text-amber-700">Patient Pays</p>
                        <p className="text-2xl font-bold text-amber-800">
                          ${patientEstimate.estimatedPatientResponsibility.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge className={
                        patientEstimate.confidence === 'high' ? 'bg-green-100 text-green-800' :
                        patientEstimate.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }>
                        {patientEstimate.confidence} confidence
                      </Badge>
                    </div>

                    <p className="text-xs text-slate-500 italic">
                      {patientEstimate.notes}
                    </p>

                    {patientEstimate.confidence !== 'high' && (
                      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5" />
                          <p className="text-sm text-yellow-800">
                            To improve accuracy, add fee schedule rates for this patient's insurance.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Info Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <DollarSign className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-medium text-slate-900">How Cost Estimation Works</h3>
                  <ul className="text-sm text-slate-600 mt-2 space-y-1">
                    <li>1. You charge <strong>$300</strong> per session</li>
                    <li>2. Insurance pays their contracted rate (based on fee schedule)</li>
                    <li>3. Patient pays <strong>coinsurance</strong> (usually 20% of allowed amount)</li>
                    <li>4. Patient also pays <strong>balance billing</strong> (your rate minus insurance allowed)</li>
                    <li>5. If deductible isn't met, patient may pay more</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
