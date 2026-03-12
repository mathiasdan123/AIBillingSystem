import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Search, Users, Phone, Mail, Calendar, Shield, CheckCircle, XCircle, AlertCircle, Loader2, RefreshCw, DollarSign, TrendingUp, Upload, FileText, CheckCircle2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import PatientIntakeForm from "@/components/PatientIntakeForm";
import CostEstimationCard from "@/components/PatientInsuranceData/CostEstimationCard";
import BenefitsSummary from "@/components/BenefitsSummary";
import { Skeleton, CardGridSkeleton } from "@/components/ui/skeleton";

interface EligibilityCheck {
  id: number;
  patientId: number;
  status: string;
  coverageType: string | null;
  effectiveDate: string | null;
  terminationDate: string | null;
  copay: string | null;
  deductible: string | null;
  deductibleMet: string | null;
  outOfPocketMax: string | null;
  outOfPocketMet: string | null;
  coinsurance: number | null;
  visitsAllowed: number | null;
  visitsUsed: number | null;
  authRequired: boolean | null;
  checkDate: string;
}

export default function Patients() {
  const { user, isAuthenticated, isLoading, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [practiceId] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [showIntakeDialog, setShowIntakeDialog] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [eligibilityResults, setEligibilityResults] = useState<Record<number, EligibilityCheck>>({});
  const [checkingEligibility, setCheckingEligibility] = useState<number | null>(null);
  const [oonEstimate, setOonEstimate] = useState<any>(null);
  const [loadingOonEstimate, setLoadingOonEstimate] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [documentType, setDocumentType] = useState<string>("sbc");

  const { data: insuranceData } = useQuery({
    queryKey: [`/api/patients/${selectedPatient?.id}/insurance-data`],
    enabled: !!selectedPatient?.id,
    retry: false,
  }) as any;

  // Fetch stored eligibility for selected patient
  const { data: storedEligibility, refetch: refetchEligibility } = useQuery({
    queryKey: [`/api/patients/${selectedPatient?.id}/eligibility`],
    enabled: !!selectedPatient?.id,
    retry: false,
  }) as any;

  // Fetch plan benefits for selected patient (admin only)
  const { data: planBenefitsData, refetch: refetchPlanBenefits } = useQuery({
    queryKey: [`/api/patients/${selectedPatient?.id}/plan-benefits`],
    enabled: !!selectedPatient?.id && isAdmin,
    retry: false,
  }) as any;

  // Redirect to login if not authenticated
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

  const { data: patients, isLoading: patientsLoading, error: patientsError } = useQuery({
    queryKey: ['/api/patients'],
    enabled: isAuthenticated,
    retry: false,
  }) as any;

  const checkEligibilityMutation = useMutation({
    mutationFn: async (data: { patientId: number; insuranceId?: number }) => {
      setCheckingEligibility(data.patientId);
      const response = await apiRequest("POST", "/api/insurance/eligibility", data);
      return response.json();
    },
    onSuccess: (data, variables) => {
      setCheckingEligibility(null);
      if (data.eligibility) {
        setEligibilityResults(prev => ({
          ...prev,
          [variables.patientId]: {
            ...data.eligibility,
            source: data.eligibility.source || 'stedi',
          }
        }));
      }
      // Refetch stored eligibility
      queryClient.invalidateQueries({ queryKey: [`/api/patients/${variables.patientId}/eligibility`] });

      const status = data.eligibility?.status;
      const source = data.eligibility?.source;
      toast({
        title: status === 'active' ? "Coverage Verified" : status === 'inactive' ? "Coverage Inactive" : "Eligibility Check Complete",
        description: status === 'active'
          ? `${source === 'stedi' ? '✓ Live data: ' : ''}${data.eligibility.coverageType || 'Plan'} - Copay: $${data.eligibility.copay || 0}`
          : status === 'inactive'
          ? "Patient coverage has been terminated"
          : "Unable to verify coverage",
        variant: status === 'active' ? "default" : "destructive",
      });
    },
    onError: (error) => {
      setCheckingEligibility(null);
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
        description: "Failed to check eligibility",
        variant: "destructive",
      });
    },
  });

  // Fetch OON estimate for selected patient (admin only)
  // Uses patient-specific plan data if available
  const fetchOonEstimate = async (patient: any) => {
    if (!isAdmin || !patient?.insuranceProvider) return;

    setLoadingOonEstimate(true);
    try {
      // Use patient-specific endpoint if plan benefits exist
      const hasPlanBenefits = planBenefitsData?.benefits;

      if (hasPlanBenefits) {
        // Use patient-specific prediction with actual plan data
        const response = await apiRequest("POST", `/api/patients/${patient.id}/oon-predict`, {
          cptCode: "90837",
          billedAmount: 200,
        });
        const data = await response.json();
        setOonEstimate(data);
      } else {
        // Fall back to generic estimate
        const zipMatch = patient.address?.match(/\b(\d{5})(?:-\d{4})?\b/);
        const zipCode = zipMatch ? zipMatch[1] : '10001';

        const response = await apiRequest("POST", "/api/oon-predict", {
          cptCode: "90837",
          insuranceProvider: patient.insuranceProvider,
          zipCode: zipCode,
          billedAmount: 200,
        });
        const data = await response.json();
        setOonEstimate(data);
      }
    } catch (error) {
      console.error("Failed to fetch OON estimate:", error);
      setOonEstimate(null);
    } finally {
      setLoadingOonEstimate(false);
    }
  };

  // Upload plan document handler
  const handleDocumentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedPatient) return;

    setUploadingDocument(true);
    try {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('documentType', documentType);
      formData.append('consentGiven', 'true');

      const response = await fetch(`/api/patients/${selectedPatient.id}/plan-documents`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data = await response.json();

      if (data.success) {
        toast({
          title: "Document Parsed Successfully",
          description: `Extracted benefits with ${Math.round((data.parseResult?.extractionConfidence || 0.7) * 100)}% confidence`,
        });
        refetchPlanBenefits();
        // Re-fetch OON estimate with new plan data
        setTimeout(() => fetchOonEstimate(selectedPatient), 500);
      } else {
        toast({
          title: "Parsing Failed",
          description: data.error || "Could not extract benefits from document",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to upload document:", error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload document",
        variant: "destructive",
      });
    } finally {
      setUploadingDocument(false);
      // Reset file input
      event.target.value = '';
    }
  };

  // Fetch OON estimate when patient is selected (admin only)
  useEffect(() => {
    if (selectedPatient && isAdmin) {
      fetchOonEstimate(selectedPatient);
    } else {
      setOonEstimate(null);
    }
  }, [selectedPatient, isAdmin, planBenefitsData]);

  // Helper function to get eligibility status badge
  const getEligibilityBadge = (patientId: number) => {
    const eligibility = eligibilityResults[patientId];
    if (!eligibility) return null;

    if (eligibility.status === 'active') {
      return (
        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
          <CheckCircle className="w-3 h-3 mr-1" />
          Active
        </Badge>
      );
    } else if (eligibility.status === 'inactive') {
      return (
        <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
          <XCircle className="w-3 h-3 mr-1" />
          Inactive
        </Badge>
      );
    } else {
      return (
        <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">
          <AlertCircle className="w-3 h-3 mr-1" />
          Unknown
        </Badge>
      );
    }
  };

  if (isLoading || patientsLoading) {
    return (
      <div className="p-6 pt-20 md:pt-6 md:ml-64">
        {/* Header skeleton */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>

        {/* Search skeleton */}
        <div className="mb-6">
          <Skeleton className="h-10 w-full rounded-md" />
        </div>

        {/* Stats cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-4 rounded" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Patient cards skeleton */}
        <CardGridSkeleton />

        {patientsError && <p className="text-red-500 text-sm mt-4">Error: {String(patientsError)}</p>}
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const filteredPatients = (patients as any[])?.filter((patient: any) => {
    const fullName = `${patient.firstName} ${patient.lastName}`.toLowerCase();
    const email = patient.email?.toLowerCase() || "";
    const phone = patient.phone?.toLowerCase() || "";
    const searchLower = searchTerm.toLowerCase();
    
    return fullName.includes(searchLower) || 
           email.includes(searchLower) || 
           phone.includes(searchLower);
  }) || [];

  const handlePatientCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/patients'] });
    setShowIntakeDialog(false);
    toast({
      title: "Success",
      description: "Patient added successfully",
    });
  };

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Patient Management</h1>
          <p className="text-slate-600">Manage patient information and insurance details</p>
        </div>
        <Dialog open={showIntakeDialog} onOpenChange={setShowIntakeDialog}>
          <DialogTrigger asChild>
            <Button className="bg-medical-blue-500 hover:bg-medical-blue-600">
              <Plus className="w-4 h-4 mr-2" />
              Add Patient
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Patient Intake Form</DialogTitle>
              <DialogDescription>
                Add a new patient with insurance information
              </DialogDescription>
            </DialogHeader>
            <PatientIntakeForm 
              practiceId={practiceId} 
              onSuccess={handlePatientCreated}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="flex items-center space-x-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input
            placeholder="Search patients by name, email, or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{patients?.length || 0}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Patients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{patients?.length || 0}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Insurance Verified</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {patients?.filter((p: any) => p.insuranceProvider).length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Patients Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredPatients?.length ? (
          filteredPatients.map((patient: any) => (
            <Card key={patient.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      {patient.firstName} {patient.lastName}
                    </CardTitle>
                    <CardDescription>
                      {patient.dateOfBirth && (
                        <span className="flex items-center mt-1">
                          <Calendar className="w-4 h-4 mr-1" />
                          {new Date(patient.dateOfBirth).toLocaleDateString()}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline">
                      {patient.insuranceProvider || "No Insurance"}
                    </Badge>
                    {getEligibilityBadge(patient.id)}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {patient.email && (
                    <div className="flex items-center text-sm text-slate-600">
                      <Mail className="w-4 h-4 mr-2" />
                      {patient.email}
                    </div>
                  )}
                  {patient.phone && (
                    <div className="flex items-center text-sm text-slate-600">
                      <Phone className="w-4 h-4 mr-2" />
                      {patient.phone}
                    </div>
                  )}
                  {patient.insuranceId && (
                    <div className="flex items-center text-sm text-slate-600">
                      <Shield className="w-4 h-4 mr-2" />
                      ID: {patient.insuranceId}
                    </div>
                  )}
                </div>
                
                <div className="mt-4 flex space-x-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={() => setSelectedPatient(patient)}
                  >
                    View Details
                  </Button>
                  {patient.insuranceProvider && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => checkEligibilityMutation.mutate({
                        patientId: patient.id,
                      })}
                      disabled={checkingEligibility === patient.id}
                    >
                      {checkingEligibility === patient.id ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          Checking...
                        </>
                      ) : (
                        <>
                          <Shield className="w-4 h-4 mr-1" />
                          Check Eligibility
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-full">
            <Card>
              <CardContent className="p-12">
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-12 w-12 text-muted-foreground mb-4" />
                  {searchTerm ? (
                    <>
                      <h3 className="text-lg font-semibold mb-2">No patients match your search</h3>
                      <p className="text-muted-foreground mb-6 max-w-md">
                        Try adjusting your search term or clearing the filter to see all patients.
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-lg font-semibold mb-2">Welcome! Add your first patient</h3>
                      <p className="text-muted-foreground mb-4 max-w-md">
                        Your patient roster is empty. Adding a patient lets you:
                      </p>
                      <ul className="text-muted-foreground text-sm mb-6 space-y-1">
                        <li>Store demographics and contact information</li>
                        <li>Verify insurance eligibility in real time</li>
                      </ul>
                      <Button
                        onClick={() => setShowIntakeDialog(true)}
                        className="bg-medical-blue-500 hover:bg-medical-blue-600"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Your First Patient
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Patient Details Modal */}
      {selectedPatient && (
        <Dialog open={!!selectedPatient} onOpenChange={() => setSelectedPatient(null)}>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedPatient.firstName} {selectedPatient.lastName}
              </DialogTitle>
              <DialogDescription>
                Patient details and insurance information
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700">Email</label>
                  <p className="text-sm text-slate-600">{selectedPatient.email || "Not provided"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Phone</label>
                  <p className="text-sm text-slate-600">{selectedPatient.phone || "Not provided"}</p>
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-700">Date of Birth</label>
                <p className="text-sm text-slate-600">
                  {selectedPatient.dateOfBirth 
                    ? new Date(selectedPatient.dateOfBirth).toLocaleDateString()
                    : "Not provided"
                  }
                </p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-700">Address</label>
                <p className="text-sm text-slate-600">{selectedPatient.address || "Not provided"}</p>
              </div>
              
              <div className="border-t pt-4">
                <h4 className="font-medium text-slate-900 mb-2">Insurance Information</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Provider</label>
                    <p className="text-sm text-slate-600">{selectedPatient.insuranceProvider || "Not provided"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Member ID</label>
                    <p className="text-sm text-slate-600">{selectedPatient.insuranceId || "Not provided"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Policy Number</label>
                    <p className="text-sm text-slate-600">{selectedPatient.policyNumber || "Not provided"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Group Number</label>
                    <p className="text-sm text-slate-600">{selectedPatient.groupNumber || "Not provided"}</p>
                  </div>
                </div>
              </div>

              {/* Benefits Summary */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-slate-900">Insurance Benefits</h4>
                  {selectedPatient.insuranceProvider && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        checkEligibilityMutation.mutate({ patientId: selectedPatient.id });
                      }}
                      disabled={checkingEligibility === selectedPatient.id}
                    >
                      {checkingEligibility === selectedPatient.id ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          Checking...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Verify Now
                        </>
                      )}
                    </Button>
                  )}
                </div>

                <BenefitsSummary
                  eligibility={
                    eligibilityResults[selectedPatient.id] ||
                    storedEligibility ||
                    null
                  }
                />
              </div>

              {/* Admin-Only: Plan Document Upload & Parsed Benefits */}
              {isAdmin && (
                <div className="border-t pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="w-4 h-4 text-blue-600" />
                    <h4 className="font-medium text-slate-900">Plan Document Analysis</h4>
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                      Admin Only
                    </Badge>
                  </div>

                  {/* Show parsed benefits if available */}
                  {planBenefitsData?.benefits ? (
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-100 mb-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-medium text-slate-700">Plan Benefits Extracted</span>
                        </div>
                        {planBenefitsData.benefits.verifiedAt && (
                          <Badge className="bg-green-100 text-green-700">Verified</Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-slate-500">OON Deductible:</span>
                          <span className="ml-2 font-medium">${planBenefitsData.benefits.oonDeductibleIndividual || '—'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">OON Coinsurance:</span>
                          <span className="ml-2 font-medium">{planBenefitsData.benefits.oonCoinsurancePercent || '—'}%</span>
                        </div>
                        <div>
                          <span className="text-slate-500">OON OOP Max:</span>
                          <span className="ml-2 font-medium">${planBenefitsData.benefits.oonOutOfPocketMax || '—'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Allowed Amt Method:</span>
                          <span className="ml-2 font-medium capitalize">{planBenefitsData.benefits.allowedAmountMethod?.replace('_', ' ') || '—'}</span>
                        </div>
                        {planBenefitsData.benefits.allowedAmountPercent && (
                          <div>
                            <span className="text-slate-500">Medicare %:</span>
                            <span className="ml-2 font-medium">{planBenefitsData.benefits.allowedAmountPercent}%</span>
                          </div>
                        )}
                        {planBenefitsData.benefits.mentalHealthVisitLimit && (
                          <div>
                            <span className="text-slate-500">MH Visit Limit:</span>
                            <span className="ml-2 font-medium">{planBenefitsData.benefits.mentalHealthVisitLimit}/year</span>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-2">
                        Confidence: {Math.round((planBenefitsData.benefits.extractionConfidence || 0.7) * 100)}%
                        {planBenefitsData.benefits.planName && ` | Plan: ${planBenefitsData.benefits.planName}`}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 mb-4">
                      <p className="text-sm text-slate-600 mb-3">
                        Upload an insurance plan document (SBC, EOB, or plan contract) to extract exact OON benefits.
                      </p>
                    </div>
                  )}

                  {/* Upload section */}
                  <div className="flex items-center gap-3">
                    <Select value={documentType} onValueChange={setDocumentType}>
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Document type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sbc">SBC (Summary)</SelectItem>
                        <SelectItem value="eob">EOB</SelectItem>
                        <SelectItem value="plan_contract">Plan Contract</SelectItem>
                        <SelectItem value="insurance_card">Insurance Card</SelectItem>
                      </SelectContent>
                    </Select>
                    <Label className="flex-1">
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        onChange={handleDocumentUpload}
                        className="hidden"
                        disabled={uploadingDocument}
                      />
                      <Button
                        variant="outline"
                        className="w-full cursor-pointer"
                        disabled={uploadingDocument}
                        asChild
                      >
                        <span>
                          {uploadingDocument ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Parsing Document...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              Upload & Parse Document
                            </>
                          )}
                        </span>
                      </Button>
                    </Label>
                  </div>
                </div>
              )}

              {/* Admin-Only: OON Reimbursement Estimate */}
              {isAdmin && selectedPatient.insuranceProvider && (
                <div className="border-t pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <DollarSign className="w-4 h-4 text-green-600" />
                    <h4 className="font-medium text-slate-900">Out-of-Network Reimbursement Estimate</h4>
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                      Admin Only
                    </Badge>
                    {oonEstimate?.hasPatientPlanData && (
                      <Badge className="bg-blue-100 text-blue-700 text-xs">Using Plan Data</Badge>
                    )}
                  </div>

                  {loadingOonEstimate ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                      <span className="ml-2 text-sm text-slate-500">Calculating estimate...</span>
                    </div>
                  ) : oonEstimate?.prediction ? (
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-100">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-500 uppercase tracking-wide">Expected Allowed</p>
                          <p className="text-xl font-bold text-green-700">
                            ${oonEstimate.prediction.estimatedAllowedAmount?.toFixed(2) || '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 uppercase tracking-wide">Est. Reimbursement</p>
                          <p className="text-xl font-bold text-emerald-700">
                            ${oonEstimate.prediction.estimatedReimbursement?.toFixed(2) || '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 uppercase tracking-wide">Patient Responsibility</p>
                          <p className="text-lg font-semibold text-amber-700">
                            ${oonEstimate.prediction.estimatedPatientResponsibility?.toFixed(2) || '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 uppercase tracking-wide">Confidence</p>
                          <Badge
                            className={
                              oonEstimate.prediction.confidenceLevel === 'high'
                                ? 'bg-green-100 text-green-700'
                                : oonEstimate.prediction.confidenceLevel === 'medium'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }
                          >
                            <TrendingUp className="w-3 h-3 mr-1" />
                            {oonEstimate.prediction.confidenceLevel || 'Unknown'}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-green-200">
                        <p className="text-xs text-slate-500">
                          <strong>CPT:</strong> 90837 (60-min therapy) |
                          <strong> Payer:</strong> {selectedPatient.insuranceProvider} |
                          <strong> Method:</strong> {oonEstimate.prediction.methodology?.replace('_', ' ') || 'Medicare multiplier'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 rounded-lg p-4 text-center">
                      <p className="text-sm text-slate-500">Unable to calculate OON estimate</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
