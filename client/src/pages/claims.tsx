import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, Search, Send, CheckCircle, Clock, XCircle, AlertCircle,
  DollarSign, FileText, TrendingUp, Ban, Eye, MoreVertical
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const claimSchema = z.object({
  patientId: z.string().min(1, "Patient is required"),
  sessionId: z.string().optional(),
  insuranceId: z.string().min(1, "Insurance is required"),
  totalAmount: z.string().min(1, "Amount is required"),
  submittedAmount: z.string().optional(),
});

type ClaimFormData = z.infer<typeof claimSchema>;

interface Claim {
  id: number;
  claimNumber: string;
  patientId: number;
  insuranceId: number;
  totalAmount: string;
  submittedAmount: string | null;
  paidAmount: string | null;
  status: string;
  aiReviewScore: string | null;
  aiReviewNotes: string | null;
  denialReason: string | null;
  createdAt: string;
  submittedAt: string | null;
  paidAt: string | null;
}

export default function Claims() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [practiceId] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [showDenyDialog, setShowDenyDialog] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [denialReason, setDenialReason] = useState("");

  const isAdmin = (user as any)?.role === 'admin';
  const isBilling = (user as any)?.role === 'billing';
  const canManageClaims = isAdmin || isBilling;

  const form = useForm<ClaimFormData>({
    resolver: zodResolver(claimSchema),
    defaultValues: {
      patientId: "",
      sessionId: "",
      insuranceId: "",
      totalAmount: "",
      submittedAmount: "",
    },
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: claims, isLoading: claimsLoading } = useQuery<Claim[]>({
    queryKey: [`/api/claims?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  });

  const { data: patients } = useQuery<any[]>({
    queryKey: [`/api/patients?practiceId=${practiceId}`],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  });

  const { data: insurances } = useQuery<any[]>({
    queryKey: ['/api/insurances'],
    enabled: isAuthenticated,
    retry: false,
  });

  const createClaimMutation = useMutation({
    mutationFn: async (data: ClaimFormData) => {
      const response = await apiRequest("POST", "/api/claims", {
        ...data,
        practiceId,
        totalAmount: parseFloat(data.totalAmount),
        submittedAmount: data.submittedAmount ? parseFloat(data.submittedAmount) : null,
        patientId: parseInt(data.patientId),
        sessionId: data.sessionId ? parseInt(data.sessionId) : null,
        insuranceId: parseInt(data.insuranceId),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      toast({
        title: "Success",
        description: "Claim created successfully with AI review",
      });
      setShowCreateDialog(false);
      form.reset();
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to create claim",
        variant: "destructive",
      });
    },
  });

  const submitClaimMutation = useMutation({
    mutationFn: async (claimId: number) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/submit`, {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      toast({
        title: data.success ? "Success" : "Error",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to submit claim",
        variant: "destructive",
      });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ claimId, paidAmount }: { claimId: number; paidAmount: string }) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/paid`, { paidAmount: parseFloat(paidAmount) });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      toast({
        title: "Success",
        description: "Claim marked as paid",
      });
      setShowPayDialog(false);
      setPaidAmount("");
      setSelectedClaim(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to mark claim as paid",
        variant: "destructive",
      });
    },
  });

  const denyClaimMutation = useMutation({
    mutationFn: async ({ claimId, denialReason }: { claimId: number; denialReason: string }) => {
      const response = await apiRequest("POST", `/api/claims/${claimId}/deny`, { denialReason });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      toast({
        title: "Success",
        description: "Claim marked as denied",
      });
      setShowDenyDialog(false);
      setDenialReason("");
      setSelectedClaim(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to deny claim",
        variant: "destructive",
      });
    },
  });

  if (isLoading || claimsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const getClaimStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'submitted':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'denied':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-slate-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
      submitted: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100',
      paid: 'bg-green-100 text-green-700 hover:bg-green-100',
      denied: 'bg-red-100 text-red-700 hover:bg-red-100',
    };
    return styles[status] || styles.draft;
  };

  const getAiScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50';
    if (score >= 60) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const filteredClaims = claims?.filter((claim) => {
    const patient = patients?.find(p => p.id === claim.patientId);
    const matchesSearch = claim.claimNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         patient?.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         patient?.lastName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || claim.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  // Calculate summary stats
  const stats = {
    total: claims?.length || 0,
    draft: claims?.filter(c => c.status === 'draft').length || 0,
    submitted: claims?.filter(c => c.status === 'submitted').length || 0,
    paid: claims?.filter(c => c.status === 'paid').length || 0,
    denied: claims?.filter(c => c.status === 'denied').length || 0,
    totalAmount: claims?.reduce((sum, c) => sum + parseFloat(c.totalAmount || '0'), 0) || 0,
    paidAmount: claims?.filter(c => c.status === 'paid').reduce((sum, c) => sum + parseFloat(c.paidAmount || '0'), 0) || 0,
    pendingAmount: claims?.filter(c => c.status === 'submitted').reduce((sum, c) => sum + parseFloat(c.totalAmount || '0'), 0) || 0,
  };

  const getPatientName = (patientId: number) => {
    const patient = patients?.find(p => p.id === patientId);
    return patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown';
  };

  const getInsuranceName = (insuranceId: number) => {
    const insurance = insurances?.find(i => i.id === insuranceId);
    return insurance?.name || 'Unknown';
  };

  const onSubmit = (data: ClaimFormData) => {
    createClaimMutation.mutate(data);
  };

  const handleViewClaim = (claim: Claim) => {
    setSelectedClaim(claim);
    setShowDetailDialog(true);
  };

  const handleMarkPaid = (claim: Claim) => {
    setSelectedClaim(claim);
    setPaidAmount(claim.totalAmount);
    setShowPayDialog(true);
  };

  const handleDenyClaim = (claim: Claim) => {
    setSelectedClaim(claim);
    setShowDenyDialog(true);
  };

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Claims Management</h1>
          <p className="text-slate-600">Create, track, and manage insurance claims</p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Claim
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create New Claim</DialogTitle>
              <DialogDescription>
                Create a new insurance claim with AI-powered review
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="patientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Patient</FormLabel>
                      <FormControl>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select patient" />
                          </SelectTrigger>
                          <SelectContent>
                            {patients?.map((patient) => (
                              <SelectItem key={patient.id} value={patient.id.toString()}>
                                {patient.firstName} {patient.lastName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="insuranceId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurance Provider</FormLabel>
                      <FormControl>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select insurance" />
                          </SelectTrigger>
                          <SelectContent>
                            {insurances?.map((insurance) => (
                              <SelectItem key={insurance.id} value={insurance.id.toString()}>
                                {insurance.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="totalAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Amount ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createClaimMutation.isPending}>
                    {createClaimMutation.isPending ? "Creating..." : "Create Claim"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Claims</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <div className="p-2 bg-slate-100 rounded-lg">
                <FileText className="w-5 h-5 text-slate-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Pending</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.submitted}</p>
              </div>
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="w-5 h-5 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Paid Amount</p>
                <p className="text-2xl font-bold text-green-600">${stats.paidAmount.toFixed(2)}</p>
              </div>
              <div className="p-2 bg-green-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Success Rate</p>
                <p className="text-2xl font-bold text-blue-600">
                  {stats.total > 0 ? ((stats.paid / stats.total) * 100).toFixed(0) : 0}%
                </p>
              </div>
              <div className="p-2 bg-blue-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input
            placeholder="Search by claim number or patient..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft ({stats.draft})</SelectItem>
            <SelectItem value="submitted">Submitted ({stats.submitted})</SelectItem>
            <SelectItem value="paid">Paid ({stats.paid})</SelectItem>
            <SelectItem value="denied">Denied ({stats.denied})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Claims List */}
      <div className="space-y-3">
        {filteredClaims.length > 0 ? (
          filteredClaims.map((claim) => (
            <Card key={claim.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left: Claim Info */}
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-slate-100 rounded-lg">
                      {getClaimStatusIcon(claim.status)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-900">{claim.claimNumber}</h3>
                        <Badge variant="secondary" className={getStatusBadge(claim.status)}>
                          {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 mt-1">
                        {getPatientName(claim.patientId)} • {getInsuranceName(claim.insuranceId)}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Created {new Date(claim.createdAt).toLocaleDateString()}
                        {claim.submittedAt && ` • Submitted ${new Date(claim.submittedAt).toLocaleDateString()}`}
                        {claim.paidAt && ` • Paid ${new Date(claim.paidAt).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>

                  {/* Right: Amount, AI Score, Actions */}
                  <div className="flex items-center gap-4">
                    {/* Amount */}
                    <div className="text-right">
                      <p className="font-semibold text-lg">${parseFloat(claim.totalAmount).toFixed(2)}</p>
                      {claim.paidAmount && (
                        <p className="text-sm text-green-600">
                          Paid: ${parseFloat(claim.paidAmount).toFixed(2)}
                        </p>
                      )}
                    </div>

                    {/* AI Score */}
                    {claim.aiReviewScore && (
                      <div className={`px-3 py-1 rounded-lg text-center ${getAiScoreColor(parseFloat(claim.aiReviewScore))}`}>
                        <p className="font-bold text-lg">{parseFloat(claim.aiReviewScore).toFixed(0)}</p>
                        <p className="text-xs">AI Score</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {claim.status === 'draft' && (
                        <Button
                          size="sm"
                          onClick={() => submitClaimMutation.mutate(claim.id)}
                          disabled={submitClaimMutation.isPending}
                        >
                          <Send className="w-4 h-4 mr-1" />
                          Submit
                        </Button>
                      )}

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleViewClaim(claim)}>
                            <Eye className="w-4 h-4 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          {canManageClaims && claim.status === 'submitted' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleMarkPaid(claim)}>
                                <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
                                Mark as Paid
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDenyClaim(claim)}>
                                <Ban className="w-4 h-4 mr-2 text-red-600" />
                                Deny Claim
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>

                {/* AI Review Notes */}
                {claim.aiReviewNotes && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <p className="text-sm text-blue-800">
                      <strong>AI Review:</strong> {claim.aiReviewNotes}
                    </p>
                  </div>
                )}

                {/* Denial Reason */}
                {claim.denialReason && (
                  <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-100">
                    <p className="text-sm text-red-800">
                      <strong>Denial Reason:</strong> {claim.denialReason}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No Claims Found</h3>
              <p className="text-slate-600 mb-4">
                {searchTerm || statusFilter !== "all"
                  ? "No claims match your search criteria"
                  : "Get started by creating your first claim"
                }
              </p>
              {!searchTerm && statusFilter === "all" && (
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Claim
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Claim Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Claim Details</DialogTitle>
            <DialogDescription>
              {selectedClaim?.claimNumber}
            </DialogDescription>
          </DialogHeader>
          {selectedClaim && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-500">Patient</Label>
                  <p className="font-medium">{getPatientName(selectedClaim.patientId)}</p>
                </div>
                <div>
                  <Label className="text-slate-500">Insurance</Label>
                  <p className="font-medium">{getInsuranceName(selectedClaim.insuranceId)}</p>
                </div>
                <div>
                  <Label className="text-slate-500">Total Amount</Label>
                  <p className="font-medium">${parseFloat(selectedClaim.totalAmount).toFixed(2)}</p>
                </div>
                <div>
                  <Label className="text-slate-500">Status</Label>
                  <Badge className={getStatusBadge(selectedClaim.status)}>
                    {selectedClaim.status.charAt(0).toUpperCase() + selectedClaim.status.slice(1)}
                  </Badge>
                </div>
                {selectedClaim.paidAmount && (
                  <div>
                    <Label className="text-slate-500">Paid Amount</Label>
                    <p className="font-medium text-green-600">${parseFloat(selectedClaim.paidAmount).toFixed(2)}</p>
                  </div>
                )}
                {selectedClaim.aiReviewScore && (
                  <div>
                    <Label className="text-slate-500">AI Review Score</Label>
                    <p className="font-medium">{parseFloat(selectedClaim.aiReviewScore).toFixed(0)}%</p>
                  </div>
                )}
              </div>

              <div>
                <Label className="text-slate-500">Created</Label>
                <p className="font-medium">{new Date(selectedClaim.createdAt).toLocaleString()}</p>
              </div>

              {selectedClaim.submittedAt && (
                <div>
                  <Label className="text-slate-500">Submitted</Label>
                  <p className="font-medium">{new Date(selectedClaim.submittedAt).toLocaleString()}</p>
                </div>
              )}

              {selectedClaim.paidAt && (
                <div>
                  <Label className="text-slate-500">Paid</Label>
                  <p className="font-medium">{new Date(selectedClaim.paidAt).toLocaleString()}</p>
                </div>
              )}

              {selectedClaim.aiReviewNotes && (
                <div>
                  <Label className="text-slate-500">AI Review Notes</Label>
                  <p className="text-sm mt-1 p-3 bg-blue-50 rounded-lg">{selectedClaim.aiReviewNotes}</p>
                </div>
              )}

              {selectedClaim.denialReason && (
                <div>
                  <Label className="text-slate-500">Denial Reason</Label>
                  <p className="text-sm mt-1 p-3 bg-red-50 rounded-lg text-red-800">{selectedClaim.denialReason}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Mark as Paid Dialog */}
      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Mark Claim as Paid</DialogTitle>
            <DialogDescription>
              Enter the amount received for {selectedClaim?.claimNumber}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Paid Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPayDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => selectedClaim && markPaidMutation.mutate({ claimId: selectedClaim.id, paidAmount })}
                disabled={markPaidMutation.isPending || !paidAmount}
              >
                {markPaidMutation.isPending ? "Saving..." : "Mark as Paid"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deny Claim Dialog */}
      <Dialog open={showDenyDialog} onOpenChange={setShowDenyDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Deny Claim</DialogTitle>
            <DialogDescription>
              Enter the reason for denying {selectedClaim?.claimNumber}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Denial Reason</Label>
              <Input
                value={denialReason}
                onChange={(e) => setDenialReason(e.target.value)}
                placeholder="Enter reason for denial"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowDenyDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => selectedClaim && denyClaimMutation.mutate({ claimId: selectedClaim.id, denialReason })}
                disabled={denyClaimMutation.isPending || !denialReason}
              >
                {denyClaimMutation.isPending ? "Saving..." : "Deny Claim"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
