import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertCircle, CheckCircle, Clock, XCircle, DollarSign,
  FileText, TrendingUp, ArrowRight, RefreshCw, Loader2,
  Calendar, User, Send, Scale, ChevronRight, AlertTriangle,
  X, Plus, Upload, Download, Eye
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TextToSpeech } from "@/components/TextToSpeech";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Appeal {
  id: number;
  claimId: number;
  practiceId: number;
  appealLevel: string;
  status: string;
  denialCategory: string | null;
  deadlineDate: string | null;
  submittedDate: string | null;
  resolvedDate: string | null;
  appealedAmount: string | null;
  recoveredAmount: string | null;
  appealLetter: string | null;
  supportingDocs: any[];
  insurerResponse: string | null;
  notes: string | null;
  assignedTo: string | null;
  createdAt: string;
  claim?: {
    id: number;
    claimNumber: string;
    totalAmount: string;
    denialReason: string | null;
  };
  patientName?: string;
}

interface DeniedClaim {
  id: number;
  claimNumber: string;
  patientId: number;
  totalAmount: string;
  denialReason: string | null;
  updatedAt: string;
  patientName?: string;
}

interface DashboardMetrics {
  totalDeniedAwaitingAppeal: number;
  appealsPendingSubmission: number;
  appealsPastDeadline: number;
  successRate: number;
  totalRecovered: number;
  last90DaysWon: number;
  last90DaysTotal: number;
}

export default function Appeals() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAppeal, setSelectedAppeal] = useState<Appeal | null>(null);
  const [selectedDeniedClaim, setSelectedDeniedClaim] = useState<DeniedClaim | null>(null);
  const [showDetailSheet, setShowDetailSheet] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [editedLetter, setEditedLetter] = useState("");
  const [editedNotes, setEditedNotes] = useState("");
  const [resolveOutcome, setResolveOutcome] = useState<"won" | "lost" | "partial">("won");
  const [recoveredAmount, setRecoveredAmount] = useState("");
  const [insurerResponse, setInsurerResponse] = useState("");

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
    }
  }, [isAuthenticated, isLoading, toast]);

  // Fetch dashboard metrics
  const { data: dashboard, isLoading: dashboardLoading } = useQuery<DashboardMetrics>({
    queryKey: ['/api/appeals/dashboard'],
    enabled: isAuthenticated,
    retry: false,
  });

  // Fetch denied claims awaiting appeal
  const { data: deniedClaims, isLoading: deniedLoading } = useQuery<DeniedClaim[]>({
    queryKey: ['/api/appeals/denied-claims'],
    enabled: isAuthenticated,
    retry: false,
  });

  // Fetch all appeals
  const { data: appeals, isLoading: appealsLoading } = useQuery<Appeal[]>({
    queryKey: ['/api/appeals'],
    enabled: isAuthenticated,
    retry: false,
  });

  // Create appeal mutation
  const createAppealMutation = useMutation({
    mutationFn: async (claimId: number) => {
      const response = await apiRequest("POST", "/api/appeals", { claimId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/appeals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/appeals/denied-claims'] });
      queryClient.invalidateQueries({ queryKey: ['/api/appeals/dashboard'] });
      toast({
        title: "Appeal Created",
        description: "AI appeal letter has been generated",
      });
      setShowCreateDialog(false);
      setSelectedDeniedClaim(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create appeal",
        variant: "destructive",
      });
    },
  });

  // Update appeal mutation
  const updateAppealMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const response = await apiRequest("PATCH", `/api/appeals/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/appeals'] });
      toast({
        title: "Appeal Updated",
        description: "Changes saved successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update appeal",
        variant: "destructive",
      });
    },
  });

  // Submit appeal mutation
  const submitAppealMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/appeals/${id}/submit`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/appeals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/appeals/dashboard'] });
      toast({
        title: "Appeal Submitted",
        description: "Appeal marked as submitted to payer",
      });
      setShowDetailSheet(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit appeal",
        variant: "destructive",
      });
    },
  });

  // Resolve appeal mutation
  const resolveAppealMutation = useMutation({
    mutationFn: async ({ id, outcome, recoveredAmount, insurerResponse }: {
      id: number;
      outcome: string;
      recoveredAmount?: string;
      insurerResponse?: string;
    }) => {
      const response = await apiRequest("POST", `/api/appeals/${id}/resolve`, {
        outcome,
        recoveredAmount,
        insurerResponse,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/appeals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/appeals/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/claims'] });
      toast({
        title: "Appeal Resolved",
        description: "Outcome recorded successfully",
      });
      setShowResolveDialog(false);
      setShowDetailSheet(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to resolve appeal",
        variant: "destructive",
      });
    },
  });

  // Escalate appeal mutation
  const escalateAppealMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/appeals/${id}/escalate`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/appeals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/appeals/dashboard'] });
      toast({
        title: "Appeal Escalated",
        description: "New appeal created at next level",
      });
      setShowDetailSheet(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to escalate appeal",
        variant: "destructive",
      });
    },
  });

  // Regenerate letter mutation
  const regenerateLetterMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/appeals/${id}/regenerate-letter`);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/appeals'] });
      setEditedLetter(data.appeal.appealLetter || "");
      toast({
        title: "Letter Regenerated",
        description: "AI has created a new appeal letter",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to regenerate letter",
        variant: "destructive",
      });
    },
  });

  // Group appeals by status for Kanban columns
  const inProgressAppeals = appeals?.filter(a =>
    ['draft', 'ready', 'submitted', 'in_review'].includes(a.status)
  ) || [];
  const resolvedAppeals = appeals?.filter(a =>
    ['won', 'lost', 'partial'].includes(a.status)
  ) || [];

  // Calculate days until deadline
  const getDaysUntilDeadline = (deadline: string | null) => {
    if (!deadline) return null;
    const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days;
  };

  // Get urgency color based on deadline
  const getUrgencyColor = (deadline: string | null) => {
    const days = getDaysUntilDeadline(deadline);
    if (days === null) return "bg-gray-100";
    if (days < 0) return "bg-red-100 border-red-300";
    if (days <= 7) return "bg-red-50 border-red-200";
    if (days <= 30) return "bg-yellow-50 border-yellow-200";
    return "bg-white";
  };

  // Get status badge variant
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft': return <Badge variant="secondary"><FileText className="w-3 h-3 mr-1" />Draft</Badge>;
      case 'ready': return <Badge variant="default" className="bg-blue-500"><CheckCircle className="w-3 h-3 mr-1" />Ready</Badge>;
      case 'submitted': return <Badge variant="default" className="bg-purple-500"><Send className="w-3 h-3 mr-1" />Submitted</Badge>;
      case 'in_review': return <Badge variant="default" className="bg-orange-500"><Clock className="w-3 h-3 mr-1" />In Review</Badge>;
      case 'won': return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Won</Badge>;
      case 'lost': return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Lost</Badge>;
      case 'partial': return <Badge variant="default" className="bg-yellow-500"><Scale className="w-3 h-3 mr-1" />Partial</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleOpenDetail = (appeal: Appeal) => {
    setSelectedAppeal(appeal);
    setEditedLetter(appeal.appealLetter || "");
    setEditedNotes(appeal.notes || "");
    setShowDetailSheet(true);
  };

  const handleSaveChanges = () => {
    if (!selectedAppeal) return;
    updateAppealMutation.mutate({
      id: selectedAppeal.id,
      updates: {
        appealLetter: editedLetter,
        notes: editedNotes,
      },
    });
  };

  const handleResolve = () => {
    if (!selectedAppeal) return;
    resolveAppealMutation.mutate({
      id: selectedAppeal.id,
      outcome: resolveOutcome,
      recoveredAmount: recoveredAmount || undefined,
      insurerResponse: insurerResponse || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="md:ml-64 p-6 min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Appeals Management</h1>
          <p className="text-slate-600">Track and manage denied claims and appeals</p>
        </div>

        {/* Dashboard Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase">Denied $ Awaiting</p>
                  <p className="text-xl font-bold text-red-600">
                    ${dashboard?.totalDeniedAwaitingAppeal?.toLocaleString() || 0}
                  </p>
                </div>
                <DollarSign className="w-8 h-8 text-red-200" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase">Pending Submit</p>
                  <p className="text-xl font-bold text-blue-600">
                    {dashboard?.appealsPendingSubmission || 0}
                  </p>
                </div>
                <FileText className="w-8 h-8 text-blue-200" />
              </div>
            </CardContent>
          </Card>

          <Card className={dashboard?.appealsPastDeadline ? "border-red-200 bg-red-50" : ""}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase">Past Deadline</p>
                  <p className={`text-xl font-bold ${dashboard?.appealsPastDeadline ? "text-red-600" : "text-slate-600"}`}>
                    {dashboard?.appealsPastDeadline || 0}
                  </p>
                </div>
                <AlertTriangle className={`w-8 h-8 ${dashboard?.appealsPastDeadline ? "text-red-300" : "text-slate-200"}`} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase">Success Rate (90d)</p>
                  <p className="text-xl font-bold text-green-600">
                    {dashboard?.successRate?.toFixed(1) || 0}%
                  </p>
                </div>
                <TrendingUp className="w-8 h-8 text-green-200" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase">$ Recovered</p>
                  <p className="text-xl font-bold text-green-600">
                    ${dashboard?.totalRecovered?.toLocaleString() || 0}
                  </p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-200" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Kanban Board */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1: Denied Claims */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-700 flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-500" />
                Denied Claims
                <Badge variant="secondary">{deniedClaims?.length || 0}</Badge>
              </h2>
            </div>
            <div className="space-y-3 max-h-[calc(100vh-350px)] overflow-y-auto">
              {deniedLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              ) : deniedClaims?.length === 0 ? (
                <Card className="bg-slate-50 border-dashed">
                  <CardContent className="py-8 text-center text-slate-500">
                    No denied claims awaiting appeal
                  </CardContent>
                </Card>
              ) : (
                deniedClaims?.map((claim) => (
                  <Card
                    key={claim.id}
                    className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-red-400"
                  >
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium text-slate-900">{claim.patientName}</p>
                          <p className="text-sm text-slate-500">#{claim.claimNumber}</p>
                        </div>
                        <span className="text-lg font-bold text-red-600">
                          ${parseFloat(claim.totalAmount).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 mb-3 line-clamp-2">
                        {claim.denialReason || "No reason provided"}
                      </p>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setSelectedDeniedClaim(claim);
                          setShowCreateDialog(true);
                        }}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Create Appeal
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>

          {/* Column 2: Appeals In Progress */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-700 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-500" />
                In Progress
                <Badge variant="secondary">{inProgressAppeals.length}</Badge>
              </h2>
            </div>
            <div className="space-y-3 max-h-[calc(100vh-350px)] overflow-y-auto">
              {appealsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              ) : inProgressAppeals.length === 0 ? (
                <Card className="bg-slate-50 border-dashed">
                  <CardContent className="py-8 text-center text-slate-500">
                    No appeals in progress
                  </CardContent>
                </Card>
              ) : (
                inProgressAppeals.map((appeal) => {
                  const days = getDaysUntilDeadline(appeal.deadlineDate);
                  return (
                    <Card
                      key={appeal.id}
                      className={`cursor-pointer hover:shadow-md transition-shadow border ${getUrgencyColor(appeal.deadlineDate)}`}
                      onClick={() => handleOpenDetail(appeal)}
                    >
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-medium text-slate-900">{appeal.patientName}</p>
                            <p className="text-sm text-slate-500">#{appeal.claim?.claimNumber}</p>
                          </div>
                          {getStatusBadge(appeal.status)}
                        </div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-lg font-bold text-slate-700">
                            ${parseFloat(appeal.appealedAmount || "0").toLocaleString()}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {appeal.appealLevel.replace('_', ' ')}
                          </Badge>
                        </div>
                        {days !== null && (
                          <div className={`flex items-center gap-1 text-sm ${
                            days < 0 ? "text-red-600 font-medium" :
                            days <= 7 ? "text-red-500" :
                            days <= 30 ? "text-yellow-600" : "text-slate-500"
                          }`}>
                            <Calendar className="w-3 h-3" />
                            {days < 0 ? `${Math.abs(days)} days overdue` :
                             days === 0 ? "Due today" :
                             `${days} days left`}
                          </div>
                        )}
                        {appeal.denialCategory && (
                          <p className="text-xs text-slate-500 mt-1">
                            Category: {appeal.denialCategory.replace('_', ' ')}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>

          {/* Column 3: Resolved */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-700 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                Resolved
                <Badge variant="secondary">{resolvedAppeals.length}</Badge>
              </h2>
            </div>
            <div className="space-y-3 max-h-[calc(100vh-350px)] overflow-y-auto">
              {appealsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              ) : resolvedAppeals.length === 0 ? (
                <Card className="bg-slate-50 border-dashed">
                  <CardContent className="py-8 text-center text-slate-500">
                    No resolved appeals
                  </CardContent>
                </Card>
              ) : (
                resolvedAppeals.map((appeal) => (
                  <Card
                    key={appeal.id}
                    className={`cursor-pointer hover:shadow-md transition-shadow border-l-4 ${
                      appeal.status === 'won' ? 'border-l-green-400' :
                      appeal.status === 'partial' ? 'border-l-yellow-400' : 'border-l-red-400'
                    }`}
                    onClick={() => handleOpenDetail(appeal)}
                  >
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium text-slate-900">{appeal.patientName}</p>
                          <p className="text-sm text-slate-500">#{appeal.claim?.claimNumber}</p>
                        </div>
                        {getStatusBadge(appeal.status)}
                      </div>
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-sm text-slate-500">Appealed</p>
                          <p className="font-medium">${parseFloat(appeal.appealedAmount || "0").toLocaleString()}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                        <div>
                          <p className="text-sm text-slate-500">Recovered</p>
                          <p className={`font-medium ${
                            appeal.status === 'won' ? 'text-green-600' :
                            appeal.status === 'partial' ? 'text-yellow-600' : 'text-slate-400'
                          }`}>
                            ${parseFloat(appeal.recoveredAmount || "0").toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Create Appeal Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Appeal</DialogTitle>
              <DialogDescription>
                AI will generate an appeal letter for this denied claim
              </DialogDescription>
            </DialogHeader>
            {selectedDeniedClaim && (
              <div className="space-y-4">
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="flex justify-between mb-2">
                    <span className="text-slate-600">Patient</span>
                    <span className="font-medium">{selectedDeniedClaim.patientName}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-slate-600">Claim #</span>
                    <span className="font-medium">{selectedDeniedClaim.claimNumber}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-slate-600">Amount</span>
                    <span className="font-medium text-red-600">
                      ${parseFloat(selectedDeniedClaim.totalAmount).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-sm text-slate-600">Denial Reason:</p>
                    <p className="text-sm mt-1">{selectedDeniedClaim.denialReason || "No reason provided"}</p>
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => selectedDeniedClaim && createAppealMutation.mutate(selectedDeniedClaim.id)}
                disabled={createAppealMutation.isPending}
              >
                {createAppealMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Appeal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Resolve Appeal Dialog */}
        <Dialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Resolve Appeal</DialogTitle>
              <DialogDescription>
                Record the outcome of this appeal
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Outcome</Label>
                <Select value={resolveOutcome} onValueChange={(v: any) => setResolveOutcome(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="won">Won - Full Payment</SelectItem>
                    <SelectItem value="partial">Partial - Partial Payment</SelectItem>
                    <SelectItem value="lost">Lost - Denied Again</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(resolveOutcome === 'won' || resolveOutcome === 'partial') && (
                <div>
                  <Label>Recovered Amount</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={recoveredAmount}
                    onChange={(e) => setRecoveredAmount(e.target.value)}
                  />
                </div>
              )}
              <div>
                <Label>Insurer Response (Optional)</Label>
                <Textarea
                  placeholder="Notes from the insurance company..."
                  value={insurerResponse}
                  onChange={(e) => setInsurerResponse(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowResolveDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleResolve}
                disabled={resolveAppealMutation.isPending}
              >
                {resolveAppealMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Record Outcome
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Appeal Detail Sheet */}
        <Sheet open={showDetailSheet} onOpenChange={setShowDetailSheet}>
          <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="flex items-center justify-between">
                Appeal Details
                {selectedAppeal && getStatusBadge(selectedAppeal.status)}
              </SheetTitle>
              <SheetDescription>
                {selectedAppeal?.claim?.claimNumber} - {selectedAppeal?.patientName}
              </SheetDescription>
            </SheetHeader>

            {selectedAppeal && (
              <div className="mt-6 space-y-6">
                {/* Claim Info */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Claim Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Amount</span>
                      <span className="font-medium">
                        ${parseFloat(selectedAppeal.appealedAmount || "0").toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Appeal Level</span>
                      <Badge variant="outline">{selectedAppeal.appealLevel.replace('_', ' ')}</Badge>
                    </div>
                    {selectedAppeal.deadlineDate && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">Deadline</span>
                        <span className={getDaysUntilDeadline(selectedAppeal.deadlineDate)! < 7 ? "text-red-600 font-medium" : ""}>
                          {new Date(selectedAppeal.deadlineDate).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                    <div className="pt-2 border-t">
                      <p className="text-slate-600 mb-1">Denial Reason:</p>
                      <p>{selectedAppeal.claim?.denialReason || "Not specified"}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Appeal Letter */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-sm">Appeal Letter</CardTitle>
                        {editedLetter && (
                          <TextToSpeech
                            text={editedLetter}
                            label="Listen"
                            size="sm"
                          />
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => regenerateLetterMutation.mutate(selectedAppeal.id)}
                        disabled={regenerateLetterMutation.isPending}
                      >
                        {regenerateLetterMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        <span className="ml-1">Regenerate</span>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      className="min-h-[300px] font-mono text-sm"
                      value={editedLetter}
                      onChange={(e) => setEditedLetter(e.target.value)}
                      placeholder="Appeal letter will be generated..."
                      disabled={['won', 'lost', 'partial'].includes(selectedAppeal.status)}
                    />
                  </CardContent>
                </Card>

                {/* Notes */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={editedNotes}
                      onChange={(e) => setEditedNotes(e.target.value)}
                      placeholder="Add internal notes..."
                      rows={3}
                    />
                  </CardContent>
                </Card>

                {/* Action Buttons */}
                {!['won', 'lost', 'partial'].includes(selectedAppeal.status) && (
                  <div className="space-y-3">
                    <Button
                      className="w-full"
                      onClick={handleSaveChanges}
                      disabled={updateAppealMutation.isPending}
                    >
                      {updateAppealMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Save Changes
                    </Button>

                    {selectedAppeal.status === 'draft' && selectedAppeal.appealLetter && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          updateAppealMutation.mutate({
                            id: selectedAppeal.id,
                            updates: { status: 'ready' },
                          });
                        }}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Mark Ready for Submission
                      </Button>
                    )}

                    {(selectedAppeal.status === 'ready' || selectedAppeal.status === 'draft') && (
                      <Button
                        variant="default"
                        className="w-full bg-purple-600 hover:bg-purple-700"
                        onClick={() => submitAppealMutation.mutate(selectedAppeal.id)}
                        disabled={submitAppealMutation.isPending || !selectedAppeal.appealLetter}
                      >
                        {submitAppealMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        <Send className="w-4 h-4 mr-2" />
                        Mark as Submitted
                      </Button>
                    )}

                    {selectedAppeal.status === 'submitted' && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          updateAppealMutation.mutate({
                            id: selectedAppeal.id,
                            updates: { status: 'in_review' },
                          });
                        }}
                      >
                        <Clock className="w-4 h-4 mr-2" />
                        Mark as In Review
                      </Button>
                    )}

                    {(selectedAppeal.status === 'submitted' || selectedAppeal.status === 'in_review') && (
                      <Button
                        variant="default"
                        className="w-full bg-green-600 hover:bg-green-700"
                        onClick={() => setShowResolveDialog(true)}
                      >
                        <Scale className="w-4 h-4 mr-2" />
                        Record Outcome
                      </Button>
                    )}
                  </div>
                )}

                {/* Escalate Option (for lost appeals) */}
                {selectedAppeal.status === 'lost' && selectedAppeal.appealLevel !== 'external_review' && (
                  <Card className="border-orange-200 bg-orange-50">
                    <CardContent className="pt-4">
                      <p className="text-sm text-orange-800 mb-3">
                        This appeal was denied. You can escalate to the next level.
                      </p>
                      <Button
                        variant="outline"
                        className="w-full border-orange-300 text-orange-700 hover:bg-orange-100"
                        onClick={() => escalateAppealMutation.mutate(selectedAppeal.id)}
                        disabled={escalateAppealMutation.isPending}
                      >
                        {escalateAppealMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        <ArrowRight className="w-4 h-4 mr-2" />
                        Escalate Appeal
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Recovered Amount (for resolved appeals) */}
                {selectedAppeal.status === 'won' || selectedAppeal.status === 'partial' ? (
                  <Card className="border-green-200 bg-green-50">
                    <CardContent className="pt-4">
                      <div className="flex justify-between items-center">
                        <span className="text-green-800">Recovered Amount</span>
                        <span className="text-2xl font-bold text-green-600">
                          ${parseFloat(selectedAppeal.recoveredAmount || "0").toLocaleString()}
                        </span>
                      </div>
                      {selectedAppeal.insurerResponse && (
                        <div className="mt-3 pt-3 border-t border-green-200">
                          <p className="text-sm text-green-700 font-medium">Insurer Response:</p>
                          <p className="text-sm text-green-800 mt-1">{selectedAppeal.insurerResponse}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
