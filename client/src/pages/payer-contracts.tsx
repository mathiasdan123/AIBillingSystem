import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, Trash2, Upload, Edit2, FileText, AlertTriangle,
  DollarSign, ArrowUpDown, ChevronLeft, TrendingDown, TrendingUp,
} from "lucide-react";

// ==================== TYPES ====================

interface PayerContract {
  id: number;
  practiceId: number;
  payerName: string;
  payerId: string | null;
  contractName: string;
  effectiveDate: string;
  terminationDate: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PayerRate {
  id: number;
  contractId: number;
  cptCode: string;
  description: string | null;
  contractedRate: string;
  medicareRate: string | null;
  effectiveDate: string | null;
  terminationDate: string | null;
  modifiers: any;
  createdAt: string;
}

interface RateComparison {
  id: number;
  cptCode: string;
  description: string | null;
  contractedRate: number;
  medicareRate: number | null;
  difference: number | null;
  percentOfMedicare: number | null;
  status: string;
}

interface ComparisonResponse {
  contract: PayerContract;
  comparison: RateComparison[];
  summary: {
    totalCodes: number;
    aboveMedicare: number;
    belowMedicare: number;
    noMedicareData: number;
    averagePercentOfMedicare: number | null;
  };
}

interface Underpayment {
  claimId: number;
  claimNumber: string | null;
  payerName: string;
  paidAmount: number;
  expectedAmount: number;
  underpaymentAmount: number;
  paidAt: string | null;
  lineItems: Array<{
    cptCode: string;
    paidRate: number;
    contractedRate: number;
    difference: number;
    units: number;
  }>;
}

interface UnderpaymentResponse {
  underpayments: Underpayment[];
  totalUnderpaymentAmount: number;
  underpaidClaimCount: number;
}

// ==================== MAIN COMPONENT ====================

export default function PayerContractsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedContract, setSelectedContract] = useState<PayerContract | null>(null);
  const [showContractDialog, setShowContractDialog] = useState(false);
  const [showRateDialog, setShowRateDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingContract, setEditingContract] = useState<PayerContract | null>(null);
  const [editingRate, setEditingRate] = useState<PayerRate | null>(null);
  const [activeTab, setActiveTab] = useState("contracts");

  // Contract form state
  const [contractForm, setContractForm] = useState({
    payerName: "",
    payerId: "",
    contractName: "",
    effectiveDate: "",
    terminationDate: "",
    status: "active",
    notes: "",
  });

  // Rate form state
  const [rateForm, setRateForm] = useState({
    cptCode: "",
    description: "",
    contractedRate: "",
    medicareRate: "",
    effectiveDate: "",
    terminationDate: "",
  });

  // CSV import state
  const [csvData, setCsvData] = useState("");

  // ==================== QUERIES ====================

  const { data: contracts = [], isLoading: loadingContracts } = useQuery<PayerContract[]>({
    queryKey: ["/api/payer-contracts"],
  });

  const { data: rates = [], isLoading: loadingRates } = useQuery<PayerRate[]>({
    queryKey: [`/api/payer-contracts/${selectedContract?.id}/rates`],
    enabled: !!selectedContract,
  });

  const { data: comparison, isLoading: loadingComparison } = useQuery<ComparisonResponse>({
    queryKey: [`/api/payer-contracts/${selectedContract?.id}/rates/compare`],
    enabled: !!selectedContract && activeTab === "comparison",
  });

  const { data: underpayments, isLoading: loadingUnderpayments } = useQuery<UnderpaymentResponse>({
    queryKey: ["/api/payer-contracts/underpayments/detect"],
    enabled: activeTab === "underpayments",
  });

  // ==================== MUTATIONS ====================

  const createContractMutation = useMutation({
    mutationFn: async (data: typeof contractForm) => {
      const res = await apiRequest("POST", "/api/payer-contracts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payer-contracts"] });
      setShowContractDialog(false);
      resetContractForm();
      toast({ title: "Contract created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create contract", description: error.message, variant: "destructive" });
    },
  });

  const updateContractMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof contractForm }) => {
      const res = await apiRequest("PUT", `/api/payer-contracts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payer-contracts"] });
      setShowContractDialog(false);
      setEditingContract(null);
      resetContractForm();
      toast({ title: "Contract updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update contract", description: error.message, variant: "destructive" });
    },
  });

  const deleteContractMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/payer-contracts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payer-contracts"] });
      if (selectedContract) setSelectedContract(null);
      toast({ title: "Contract deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete contract", description: error.message, variant: "destructive" });
    },
  });

  const createRateMutation = useMutation({
    mutationFn: async (data: typeof rateForm) => {
      const res = await apiRequest("POST", `/api/payer-contracts/${selectedContract?.id}/rates`, {
        ...data,
        contractedRate: parseFloat(data.contractedRate),
        medicareRate: data.medicareRate ? parseFloat(data.medicareRate) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/payer-contracts/${selectedContract?.id}/rates`] });
      queryClient.invalidateQueries({ queryKey: [`/api/payer-contracts/${selectedContract?.id}/rates/compare`] });
      setShowRateDialog(false);
      resetRateForm();
      toast({ title: "Rate added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add rate", description: error.message, variant: "destructive" });
    },
  });

  const updateRateMutation = useMutation({
    mutationFn: async ({ rateId, data }: { rateId: number; data: typeof rateForm }) => {
      const res = await apiRequest("PUT", `/api/payer-contracts/${selectedContract?.id}/rates/${rateId}`, {
        ...data,
        contractedRate: parseFloat(data.contractedRate),
        medicareRate: data.medicareRate ? parseFloat(data.medicareRate) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/payer-contracts/${selectedContract?.id}/rates`] });
      queryClient.invalidateQueries({ queryKey: [`/api/payer-contracts/${selectedContract?.id}/rates/compare`] });
      setShowRateDialog(false);
      setEditingRate(null);
      resetRateForm();
      toast({ title: "Rate updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update rate", description: error.message, variant: "destructive" });
    },
  });

  const deleteRateMutation = useMutation({
    mutationFn: async (rateId: number) => {
      await apiRequest("DELETE", `/api/payer-contracts/${selectedContract?.id}/rates/${rateId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/payer-contracts/${selectedContract?.id}/rates`] });
      queryClient.invalidateQueries({ queryKey: [`/api/payer-contracts/${selectedContract?.id}/rates/compare`] });
      toast({ title: "Rate deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete rate", description: error.message, variant: "destructive" });
    },
  });

  const importRatesMutation = useMutation({
    mutationFn: async (csv: string) => {
      const res = await apiRequest("POST", `/api/payer-contracts/${selectedContract?.id}/rates/import`, { csvData: csv });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/payer-contracts/${selectedContract?.id}/rates`] });
      queryClient.invalidateQueries({ queryKey: [`/api/payer-contracts/${selectedContract?.id}/rates/compare`] });
      setShowImportDialog(false);
      setCsvData("");
      toast({
        title: `Imported ${data.imported} rates`,
        description: data.errors ? `${data.errors.length} errors occurred` : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  // ==================== HELPERS ====================

  function resetContractForm() {
    setContractForm({ payerName: "", payerId: "", contractName: "", effectiveDate: "", terminationDate: "", status: "active", notes: "" });
  }

  function resetRateForm() {
    setRateForm({ cptCode: "", description: "", contractedRate: "", medicareRate: "", effectiveDate: "", terminationDate: "" });
  }

  function openEditContract(contract: PayerContract) {
    setEditingContract(contract);
    setContractForm({
      payerName: contract.payerName,
      payerId: contract.payerId || "",
      contractName: contract.contractName,
      effectiveDate: contract.effectiveDate,
      terminationDate: contract.terminationDate || "",
      status: contract.status,
      notes: contract.notes || "",
    });
    setShowContractDialog(true);
  }

  function openEditRate(rate: PayerRate) {
    setEditingRate(rate);
    setRateForm({
      cptCode: rate.cptCode,
      description: rate.description || "",
      contractedRate: rate.contractedRate,
      medicareRate: rate.medicareRate || "",
      effectiveDate: rate.effectiveDate || "",
      terminationDate: rate.terminationDate || "",
    });
    setShowRateDialog(true);
  }

  function openNewContract() {
    setEditingContract(null);
    resetContractForm();
    setShowContractDialog(true);
  }

  function openNewRate() {
    setEditingRate(null);
    resetRateForm();
    setShowRateDialog(true);
  }

  function handleContractSubmit() {
    if (editingContract) {
      updateContractMutation.mutate({ id: editingContract.id, data: contractForm });
    } else {
      createContractMutation.mutate(contractForm);
    }
  }

  function handleRateSubmit() {
    if (editingRate) {
      updateRateMutation.mutate({ rateId: editingRate.id, data: rateForm });
    } else {
      createRateMutation.mutate(rateForm);
    }
  }

  function handleFileImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      setCsvData(e.target?.result as string);
    };
    reader.readAsText(file);
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Active</Badge>;
      case "expired":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Expired</Badge>;
      case "pending":
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  }

  // ==================== RENDER ====================

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payer Contracts</h1>
          <p className="text-muted-foreground">
            Manage negotiated rates and contracts with insurance payers
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="contracts">
            <FileText className="w-4 h-4 mr-2" />
            Contracts
          </TabsTrigger>
          <TabsTrigger value="comparison" disabled={!selectedContract}>
            <ArrowUpDown className="w-4 h-4 mr-2" />
            Rate Comparison
          </TabsTrigger>
          <TabsTrigger value="underpayments">
            <AlertTriangle className="w-4 h-4 mr-2" />
            Underpayments
          </TabsTrigger>
        </TabsList>

        {/* ==================== CONTRACTS TAB ==================== */}
        <TabsContent value="contracts" className="space-y-4">
          {selectedContract ? (
            // Contract detail view with rates
            <>
              <div className="flex items-center gap-2 mb-4">
                <Button variant="ghost" size="sm" onClick={() => setSelectedContract(null)}>
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back to Contracts
                </Button>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {selectedContract.contractName}
                        {getStatusBadge(selectedContract.status)}
                      </CardTitle>
                      <CardDescription>
                        {selectedContract.payerName}
                        {selectedContract.payerId ? ` (ID: ${selectedContract.payerId})` : ""}
                        {" | "}
                        Effective: {selectedContract.effectiveDate}
                        {selectedContract.terminationDate ? ` - ${selectedContract.terminationDate}` : " (no end date)"}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditContract(selectedContract)}>
                        <Edit2 className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (confirm("Delete this contract and all its rates?")) {
                            deleteContractMutation.mutate(selectedContract.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </div>
                  {selectedContract.notes && (
                    <p className="text-sm text-muted-foreground mt-2">{selectedContract.notes}</p>
                  )}
                </CardHeader>
              </Card>

              {/* Rates table */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Contracted Rates</CardTitle>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)}>
                        <Upload className="w-4 h-4 mr-1" />
                        Import CSV
                      </Button>
                      <Button size="sm" onClick={openNewRate}>
                        <Plus className="w-4 h-4 mr-1" />
                        Add Rate
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {loadingRates ? (
                    <p className="text-muted-foreground">Loading rates...</p>
                  ) : rates.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>No rates configured for this contract.</p>
                      <p className="text-sm">Add individual rates or import from CSV.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>CPT Code</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Contracted Rate</TableHead>
                          <TableHead className="text-right">Medicare Rate</TableHead>
                          <TableHead className="text-right">% of Medicare</TableHead>
                          <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rates.map((rate) => {
                          const contracted = parseFloat(rate.contractedRate);
                          const medicare = rate.medicareRate ? parseFloat(rate.medicareRate) : null;
                          const pctMedicare = medicare && medicare > 0
                            ? Math.round((contracted / medicare) * 100)
                            : null;

                          return (
                            <TableRow key={rate.id}>
                              <TableCell className="font-mono font-medium">{rate.cptCode}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{rate.description || "-"}</TableCell>
                              <TableCell className="text-right font-medium">${contracted.toFixed(2)}</TableCell>
                              <TableCell className="text-right">{medicare != null ? `$${medicare.toFixed(2)}` : "-"}</TableCell>
                              <TableCell className="text-right">
                                {pctMedicare != null ? (
                                  <span className={pctMedicare >= 100 ? "text-green-600" : "text-red-600"}>
                                    {pctMedicare}%
                                  </span>
                                ) : "-"}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => openEditRate(rate)}>
                                    <Edit2 className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      if (confirm("Delete this rate?")) {
                                        deleteRateMutation.mutate(rate.id);
                                      }
                                    }}
                                  >
                                    <Trash2 className="w-3 h-3 text-red-500" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            // Contract list view
            <>
              <div className="flex justify-end">
                <Button onClick={openNewContract}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Contract
                </Button>
              </div>

              {loadingContracts ? (
                <p className="text-muted-foreground">Loading contracts...</p>
              ) : contracts.length === 0 ? (
                <Card>
                  <CardContent className="text-center py-12">
                    <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
                    <h3 className="text-lg font-medium mb-2">No Payer Contracts</h3>
                    <p className="text-muted-foreground mb-4">
                      Add your insurance payer contracts to track negotiated rates and detect underpayments.
                    </p>
                    <Button onClick={openNewContract}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Your First Contract
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {contracts.map((contract) => (
                    <Card
                      key={contract.id}
                      className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => {
                        setSelectedContract(contract);
                      }}
                    >
                      <CardContent className="flex items-center justify-between p-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{contract.contractName}</span>
                            {getStatusBadge(contract.status)}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {contract.payerName}
                            {contract.payerId ? ` (${contract.payerId})` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Effective: {contract.effectiveDate}
                            {contract.terminationDate ? ` - ${contract.terminationDate}` : ""}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditContract(contract);
                            }}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Delete this contract and all its rates?")) {
                                deleteContractMutation.mutate(contract.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ==================== RATE COMPARISON TAB ==================== */}
        <TabsContent value="comparison" className="space-y-4">
          {!selectedContract ? (
            <Card>
              <CardContent className="text-center py-12">
                <ArrowUpDown className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">Select a contract from the Contracts tab to compare rates.</p>
              </CardContent>
            </Card>
          ) : loadingComparison ? (
            <p className="text-muted-foreground">Loading comparison...</p>
          ) : comparison ? (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{comparison.summary.totalCodes}</p>
                    <p className="text-xs text-muted-foreground">Total CPT Codes</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{comparison.summary.aboveMedicare}</p>
                    <p className="text-xs text-muted-foreground">Above Medicare</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{comparison.summary.belowMedicare}</p>
                    <p className="text-xs text-muted-foreground">Below Medicare</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">
                      {comparison.summary.averagePercentOfMedicare != null
                        ? `${comparison.summary.averagePercentOfMedicare}%`
                        : "N/A"}
                    </p>
                    <p className="text-xs text-muted-foreground">Avg % of Medicare</p>
                  </CardContent>
                </Card>
              </div>

              {/* Comparison table */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    Rate Comparison: {selectedContract.contractName} ({selectedContract.payerName})
                  </CardTitle>
                  <CardDescription>Contracted rates compared to Medicare fee schedule</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>CPT Code</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Contracted</TableHead>
                        <TableHead className="text-right">Medicare</TableHead>
                        <TableHead className="text-right">Difference</TableHead>
                        <TableHead className="text-right">% of Medicare</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comparison.comparison.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono font-medium">{row.cptCode}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{row.description || "-"}</TableCell>
                          <TableCell className="text-right font-medium">${row.contractedRate.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            {row.medicareRate != null ? `$${row.medicareRate.toFixed(2)}` : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.difference != null ? (
                              <span className={row.difference >= 0 ? "text-green-600" : "text-red-600"}>
                                {row.difference >= 0 ? "+" : ""}${row.difference.toFixed(2)}
                              </span>
                            ) : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.percentOfMedicare != null ? (
                              <span className={row.percentOfMedicare >= 100 ? "text-green-600" : "text-red-600"}>
                                {row.percentOfMedicare}%
                              </span>
                            ) : "-"}
                          </TableCell>
                          <TableCell>
                            {row.status === "above_medicare" && (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                <TrendingUp className="w-3 h-3 mr-1" />
                                Above
                              </Badge>
                            )}
                            {row.status === "below_medicare" && (
                              <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                                <TrendingDown className="w-3 h-3 mr-1" />
                                Below
                              </Badge>
                            )}
                            {row.status === "no_medicare_data" && (
                              <Badge variant="outline">No Data</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        {/* ==================== UNDERPAYMENTS TAB ==================== */}
        <TabsContent value="underpayments" className="space-y-4">
          {loadingUnderpayments ? (
            <p className="text-muted-foreground">Analyzing claims for underpayments...</p>
          ) : underpayments ? (
            <>
              {/* Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{underpayments.underpaidClaimCount}</p>
                    <p className="text-xs text-muted-foreground">Underpaid Claims</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">
                      ${underpayments.totalUnderpaymentAmount.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Underpayment</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">
                      {underpayments.underpaidClaimCount > 0
                        ? `$${(underpayments.totalUnderpaymentAmount / underpayments.underpaidClaimCount).toFixed(2)}`
                        : "$0.00"}
                    </p>
                    <p className="text-xs text-muted-foreground">Avg Underpayment</p>
                  </CardContent>
                </Card>
              </div>

              {underpayments.underpayments.length === 0 ? (
                <Card>
                  <CardContent className="text-center py-12">
                    <DollarSign className="w-16 h-16 mx-auto mb-4 text-green-500 opacity-50" />
                    <h3 className="text-lg font-medium mb-2">No Underpayments Detected</h3>
                    <p className="text-muted-foreground">
                      All paid claims match or exceed contracted rates.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Underpaid Claims</CardTitle>
                    <CardDescription>
                      Claims where the payment was less than the contracted rate
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Claim #</TableHead>
                          <TableHead>Payer</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Expected</TableHead>
                          <TableHead className="text-right">Underpayment</TableHead>
                          <TableHead>Paid Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {underpayments.underpayments.map((up) => (
                          <TableRow key={up.claimId}>
                            <TableCell className="font-mono">{up.claimNumber || `#${up.claimId}`}</TableCell>
                            <TableCell>{up.payerName}</TableCell>
                            <TableCell className="text-right">${up.paidAmount.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${up.expectedAmount.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-medium text-red-600">
                              -${up.underpaymentAmount.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {up.paidAt ? new Date(up.paidAt).toLocaleDateString() : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </TabsContent>
      </Tabs>

      {/* ==================== CONTRACT DIALOG ==================== */}
      <Dialog open={showContractDialog} onOpenChange={setShowContractDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingContract ? "Edit Contract" : "New Payer Contract"}</DialogTitle>
            <DialogDescription>
              {editingContract ? "Update the contract details." : "Add a new insurance payer contract with negotiated rates."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="payerName">Payer Name *</Label>
                <Input
                  id="payerName"
                  value={contractForm.payerName}
                  onChange={(e) => setContractForm({ ...contractForm, payerName: e.target.value })}
                  placeholder="e.g., Blue Cross Blue Shield"
                />
              </div>
              <div>
                <Label htmlFor="payerId">Payer ID</Label>
                <Input
                  id="payerId"
                  value={contractForm.payerId}
                  onChange={(e) => setContractForm({ ...contractForm, payerId: e.target.value })}
                  placeholder="External payer ID"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="contractName">Contract Name *</Label>
              <Input
                id="contractName"
                value={contractForm.contractName}
                onChange={(e) => setContractForm({ ...contractForm, contractName: e.target.value })}
                placeholder="e.g., 2025 In-Network Agreement"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="effectiveDate">Effective Date *</Label>
                <Input
                  id="effectiveDate"
                  type="date"
                  value={contractForm.effectiveDate}
                  onChange={(e) => setContractForm({ ...contractForm, effectiveDate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="terminationDate">Termination Date</Label>
                <Input
                  id="terminationDate"
                  type="date"
                  value={contractForm.terminationDate}
                  onChange={(e) => setContractForm({ ...contractForm, terminationDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={contractForm.status}
                onValueChange={(value) => setContractForm({ ...contractForm, status: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={contractForm.notes}
                onChange={(e) => setContractForm({ ...contractForm, notes: e.target.value })}
                placeholder="Additional notes about this contract..."
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowContractDialog(false)}>Cancel</Button>
              <Button
                onClick={handleContractSubmit}
                disabled={!contractForm.payerName || !contractForm.contractName || !contractForm.effectiveDate}
              >
                {editingContract ? "Update Contract" : "Create Contract"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ==================== RATE DIALOG ==================== */}
      <Dialog open={showRateDialog} onOpenChange={setShowRateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRate ? "Edit Rate" : "Add Contracted Rate"}</DialogTitle>
            <DialogDescription>
              {editingRate ? "Update the rate details." : "Add a contracted rate for a specific CPT code."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cptCode">CPT Code *</Label>
                <Input
                  id="cptCode"
                  value={rateForm.cptCode}
                  onChange={(e) => setRateForm({ ...rateForm, cptCode: e.target.value })}
                  placeholder="e.g., 97110"
                />
              </div>
              <div>
                <Label htmlFor="contractedRate">Contracted Rate *</Label>
                <Input
                  id="contractedRate"
                  type="number"
                  step="0.01"
                  value={rateForm.contractedRate}
                  onChange={(e) => setRateForm({ ...rateForm, contractedRate: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="rateDescription">Description</Label>
              <Input
                id="rateDescription"
                value={rateForm.description}
                onChange={(e) => setRateForm({ ...rateForm, description: e.target.value })}
                placeholder="e.g., Therapeutic exercises"
              />
            </div>
            <div>
              <Label htmlFor="medicareRate">Medicare Rate (for comparison)</Label>
              <Input
                id="medicareRate"
                type="number"
                step="0.01"
                value={rateForm.medicareRate}
                onChange={(e) => setRateForm({ ...rateForm, medicareRate: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="rateEffective">Effective Date</Label>
                <Input
                  id="rateEffective"
                  type="date"
                  value={rateForm.effectiveDate}
                  onChange={(e) => setRateForm({ ...rateForm, effectiveDate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="rateTermination">Termination Date</Label>
                <Input
                  id="rateTermination"
                  type="date"
                  value={rateForm.terminationDate}
                  onChange={(e) => setRateForm({ ...rateForm, terminationDate: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowRateDialog(false)}>Cancel</Button>
              <Button
                onClick={handleRateSubmit}
                disabled={!rateForm.cptCode || !rateForm.contractedRate}
              >
                {editingRate ? "Update Rate" : "Add Rate"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ==================== CSV IMPORT DIALOG ==================== */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Rates from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV file with columns: cptCode, description, rate (and optionally medicareRate).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="csvFile">CSV File</Label>
              <Input
                id="csvFile"
                type="file"
                accept=".csv,.txt"
                onChange={handleFileImport}
              />
            </div>
            <div>
              <Label htmlFor="csvText">Or paste CSV data</Label>
              <Textarea
                id="csvText"
                value={csvData}
                onChange={(e) => setCsvData(e.target.value)}
                placeholder={"cptCode,description,rate,medicareRate\n97110,Therapeutic exercises,85.00,68.50\n97140,Manual therapy,90.00,72.00"}
                rows={8}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancel</Button>
              <Button
                onClick={() => importRatesMutation.mutate(csvData)}
                disabled={!csvData || importRatesMutation.isPending}
              >
                {importRatesMutation.isPending ? "Importing..." : "Import Rates"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
