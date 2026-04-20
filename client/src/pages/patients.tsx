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
import { Plus, Search, Users, Phone, Mail, Calendar, Shield, CheckCircle, XCircle, AlertCircle, Loader2, RefreshCw, DollarSign, TrendingUp, Upload, FileText, CheckCircle2, ListChecks, ClipboardCheck, Send, ExternalLink, CreditCard } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import PatientIntakeForm from "@/components/PatientIntakeForm";
import CostEstimationCard from "@/components/PatientInsuranceData/CostEstimationCard";
import BenefitsSummary from "@/components/BenefitsSummary";
import BenefitsVerificationCard from "@/components/BenefitsVerificationCard";
import InsuranceDocumentsSection from "@/components/InsuranceDocumentsSection";
import { Skeleton, CardGridSkeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PatientBillingTab from "@/components/PatientBillingTab";
import PatientProgressNotesManager from "@/components/PatientProgressNotesManager";

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

// Helper component to display intake data from the patient portal
function PatientIntakeDataView({ patient }: { patient: any }) {
  const { toast } = useToast();
  const intakeData = typeof patient.intakeData === 'string'
    ? JSON.parse(patient.intakeData)
    : patient.intakeData;

  // Slice β — send magic-link email to patient with a direct intake URL.
  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/patients/${patient.id}/send-intake-invite`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: 'Intake invite sent',
        description: `Sent to ${data.sentTo}. Link expires in 15 minutes.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not send invite',
        description: err?.message ?? 'Please try again shortly.',
        variant: 'destructive',
      });
    },
  });

  const handleSendPortalInvite = () => {
    if (!patient.email) {
      toast({
        title: 'No email on file',
        description: 'Add an email to this patient (Details tab) before sending an invite.',
        variant: 'destructive',
      });
      return;
    }
    inviteMutation.mutate();
  };

  const handleStartIntake = () => {
    // Opens the full-page wizard. Currently this creates a NEW patient
    // record — a follow-up slice will add `?patientId=<id>` pre-fill +
    // PATCH semantics for editing existing patients without duplicates.
    window.open('/intake', '_blank', 'noopener,noreferrer');
  };

  if (!intakeData && !patient.intakeCompletedAt) {
    return (
      <div className="text-center py-10 space-y-4">
        <ClipboardCheck className="w-12 h-12 text-muted-foreground mx-auto" />
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-1">No Intake Data Yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Send the patient a portal link to complete it themselves, or start the intake in-office.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendPortalInvite}
            disabled={inviteMutation.isPending}
          >
            {inviteMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Mail className="w-4 h-4 mr-2" />
            )}
            Invite via Portal
          </Button>
          <Button size="sm" onClick={handleStartIntake}>
            <ClipboardCheck className="w-4 h-4 mr-2" />
            Start Intake In-Office
          </Button>
        </div>
      </div>
    );
  }

  const sections = intakeData?.sections || {};
  const completedAt = patient.intakeCompletedAt;

  // Helper to render a labeled field
  const Field = ({ label, value }: { label: string; value: any }) => {
    if (!value || value === '') return null;
    return (
      <div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <p className="text-sm text-foreground">{String(value)}</p>
      </div>
    );
  };

  // Helper to render a section
  const Section = ({ title, data, fields }: { title: string; data: any; fields: { key: string; label: string }[] }) => {
    if (!data || Object.keys(data).length === 0) return null;
    const visibleFields = fields.filter(f => data[f.key] && data[f.key] !== '');
    if (visibleFields.length === 0) return null;
    return (
      <div className="border-t pt-4">
        <h4 className="font-medium text-foreground mb-3">{title}</h4>
        <div className="grid grid-cols-2 gap-3">
          {visibleFields.map(f => (
            <Field key={f.key} label={f.label} value={data[f.key]} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Intake Status + actions */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {completedAt ? (
            <Badge className="bg-green-100 text-green-700">
              <CheckCircle className="w-3 h-3 mr-1" />
              Intake Complete
            </Badge>
          ) : (
            <Badge className="bg-yellow-100 text-yellow-700">
              <AlertCircle className="w-3 h-3 mr-1" />
              Intake In Progress
            </Badge>
          )}
          {completedAt && (
            <span className="text-xs text-muted-foreground">
              Completed {new Date(completedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendPortalInvite}
            disabled={inviteMutation.isPending}
          >
            {inviteMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Mail className="w-4 h-4 mr-2" />
            )}
            Re-invite via Portal
          </Button>
          <Button variant="outline" size="sm" onClick={handleStartIntake}>
            <ExternalLink className="w-4 h-4 mr-2" />
            Open Intake Wizard
          </Button>
        </div>
      </div>

      {/* Patient Info Section */}
      <Section
        title="Patient Information"
        data={sections.patientInfo}
        fields={[
          { key: 'firstName', label: 'First Name' },
          { key: 'lastName', label: 'Last Name' },
          { key: 'preferredName', label: 'Preferred Name' },
          { key: 'dateOfBirth', label: 'Date of Birth' },
          { key: 'sex', label: 'Sex' },
          { key: 'gender', label: 'Gender' },
          { key: 'school', label: 'School' },
          { key: 'grade', label: 'Grade' },
          { key: 'teacher', label: 'Teacher' },
          { key: 'schoolConcerns', label: 'School Concerns' },
          { key: 'primaryLanguage', label: 'Primary Language' },
          { key: 'referralSource', label: 'Referral Source' },
          { key: 'referringPhysician', label: 'Referring Physician' },
          { key: 'pediatrician', label: 'Pediatrician' },
        ]}
      />

      {/* Parent/Guardian 1 */}
      <Section
        title="Parent/Guardian 1"
        data={sections.parent1}
        fields={[
          { key: 'name', label: 'Name' },
          { key: 'relationship', label: 'Relationship' },
          { key: 'phone', label: 'Phone' },
          { key: 'cell', label: 'Cell Phone' },
          { key: 'email', label: 'Email' },
          { key: 'address', label: 'Address' },
          { key: 'city', label: 'City' },
          { key: 'state', label: 'State' },
          { key: 'zip', label: 'ZIP' },
          { key: 'employer', label: 'Employer' },
          { key: 'workPhone', label: 'Work Phone' },
        ]}
      />

      {/* Parent/Guardian 2 */}
      <Section
        title="Parent/Guardian 2"
        data={sections.parent2}
        fields={[
          { key: 'name', label: 'Name' },
          { key: 'relationship', label: 'Relationship' },
          { key: 'phone', label: 'Phone' },
          { key: 'cell', label: 'Cell Phone' },
          { key: 'email', label: 'Email' },
          { key: 'address', label: 'Address' },
        ]}
      />

      {/* Emergency Contact */}
      <Section
        title="Emergency Contact"
        data={sections.emergencyContact}
        fields={[
          { key: 'name', label: 'Name' },
          { key: 'relationship', label: 'Relationship' },
          { key: 'phone', label: 'Phone' },
          { key: 'alternatePhone', label: 'Alternate Phone' },
        ]}
      />

      {/* Medical History */}
      <Section
        title="Medical History"
        data={sections.medicalHistory}
        fields={[
          { key: 'diagnosis', label: 'Diagnosis' },
          { key: 'currentMedications', label: 'Current Medications' },
          { key: 'allergies', label: 'Allergies' },
          { key: 'medicalConditions', label: 'Medical Conditions' },
          { key: 'surgeries', label: 'Surgeries' },
          { key: 'hospitalizations', label: 'Hospitalizations' },
          { key: 'primaryPhysician', label: 'Primary Physician' },
          { key: 'visionHearing', label: 'Vision/Hearing' },
        ]}
      />

      {/* Birth History */}
      <Section
        title="Birth History"
        data={sections.birthHistory}
        fields={[
          { key: 'birthWeight', label: 'Birth Weight' },
          { key: 'gestationalAge', label: 'Gestational Age' },
          { key: 'deliveryType', label: 'Delivery Type' },
          { key: 'complications', label: 'Complications' },
          { key: 'nicuStay', label: 'NICU Stay' },
          { key: 'pregnancyComplications', label: 'Pregnancy Complications' },
        ]}
      />

      {/* Developmental Milestones */}
      <Section
        title="Developmental Milestones"
        data={sections.developmentalMilestones}
        fields={[
          { key: 'satAlone', label: 'Sat Alone' },
          { key: 'crawled', label: 'Crawled' },
          { key: 'walked', label: 'Walked' },
          { key: 'firstWords', label: 'First Words' },
          { key: 'sentences', label: 'Sentences' },
          { key: 'toiletTrained', label: 'Toilet Trained' },
          { key: 'concerns', label: 'Concerns' },
        ]}
      />

      {/* Treatment History */}
      <Section
        title="Treatment History"
        data={sections.treatmentHistory}
        fields={[
          { key: 'previousTherapy', label: 'Previous Therapy' },
          { key: 'therapyType', label: 'Therapy Type' },
          { key: 'duration', label: 'Duration' },
          { key: 'provider', label: 'Provider' },
          { key: 'outcomes', label: 'Outcomes' },
        ]}
      />

      {/* Sensory Processing */}
      <Section
        title="Sensory Processing"
        data={sections.sensoryProcessing}
        fields={[
          { key: 'tactileSensitivity', label: 'Tactile Sensitivity' },
          { key: 'vestibularResponses', label: 'Vestibular Responses' },
          { key: 'auditorySensitivity', label: 'Auditory Sensitivity' },
          { key: 'visualSensitivity', label: 'Visual Sensitivity' },
          { key: 'oralSensitivity', label: 'Oral Sensitivity' },
          { key: 'seekingBehaviors', label: 'Seeking Behaviors' },
          { key: 'additionalNotes', label: 'Additional Notes' },
        ]}
      />

      {/* Social/Emotional */}
      <Section
        title="Social-Emotional Skills"
        data={sections.socialEmotional}
        fields={[
          { key: 'socialInteraction', label: 'Social Interaction' },
          { key: 'emotionalRegulation', label: 'Emotional Regulation' },
          { key: 'behaviorConcerns', label: 'Behavior Concerns' },
          { key: 'friendships', label: 'Friendships' },
          { key: 'selfCare', label: 'Self-Care Skills' },
        ]}
      />

      {/* Visual/Motor Skills */}
      <Section
        title="Visual & Motor Skills"
        data={sections.visualMotorSkills}
        fields={[
          { key: 'handedness', label: 'Handedness' },
          { key: 'handwriting', label: 'Handwriting' },
          { key: 'scissors', label: 'Scissors Use' },
          { key: 'drawing', label: 'Drawing' },
          { key: 'fineMotor', label: 'Fine Motor' },
          { key: 'grossMotor', label: 'Gross Motor' },
          { key: 'coordination', label: 'Coordination' },
        ]}
      />

      {/* Nutrition */}
      <Section
        title="Nutrition History"
        data={sections.nutritionHistory}
        fields={[
          { key: 'feedingConcerns', label: 'Feeding Concerns' },
          { key: 'dietaryRestrictions', label: 'Dietary Restrictions' },
          { key: 'foodPreferences', label: 'Food Preferences' },
          { key: 'mealtime', label: 'Mealtime Behavior' },
        ]}
      />

      {/* Social History */}
      <Section
        title="Social History"
        data={sections.socialHistory}
        fields={[
          { key: 'familyStructure', label: 'Family Structure' },
          { key: 'siblings', label: 'Siblings' },
          { key: 'livingSituation', label: 'Living Situation' },
          { key: 'childcare', label: 'Childcare' },
          { key: 'activities', label: 'Activities' },
          { key: 'concerns', label: 'Concerns' },
        ]}
      />

      {/* Consents Summary */}
      {intakeData?.questionnaireCompleted && (
        <div className="border-t pt-4">
          <h4 className="font-medium text-foreground mb-2">Consent Status</h4>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="w-4 h-4" />
              Intake questionnaire submitted
            </div>
            {intakeData?.submittedAt && (
              <p className="text-xs text-muted-foreground ml-6">
                Submitted: {new Date(intakeData.submittedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Patients() {
  const { user, isAuthenticated, isLoading, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [practiceId] = useState(user?.practiceId || 1);
  const [searchTerm, setSearchTerm] = useState("");
  const [showIntakeDialog, setShowIntakeDialog] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [eligibilityResults, setEligibilityResults] = useState<Record<number, EligibilityCheck>>({});
  const [checkingEligibility, setCheckingEligibility] = useState<number | null>(null);
  const [oonEstimate, setOonEstimate] = useState<any>(null);
  const [loadingOonEstimate, setLoadingOonEstimate] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [documentType, setDocumentType] = useState<string>("sbc");
  const [selectedPatientIds, setSelectedPatientIds] = useState<Set<number>>(new Set());
  const [bulkCheckInProgress, setBulkCheckInProgress] = useState(false);
  const [bulkCheckProgress, setBulkCheckProgress] = useState(0);
  const [bulkCheckTotal, setBulkCheckTotal] = useState(0);
  const [bulkCheckResults, setBulkCheckResults] = useState<{
    summary: { checked: number; eligible: number; ineligible: number; errors: number };
    results: Array<{ patientId: number; patientName: string; status: string; eligibility: any; error?: string }>;
  } | null>(null);
  const [showBulkResultsDialog, setShowBulkResultsDialog] = useState(false);

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

  // Fetch insurance card images for selected patient
  const { data: insuranceCards } = useQuery({
    queryKey: [`/api/patients/${selectedPatient?.id}/insurance-cards`],
    enabled: !!selectedPatient?.id,
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

  const { data: patientsResponse, isLoading: patientsLoading, error: patientsError } = useQuery({
    queryKey: ['/api/patients'],
    enabled: isAuthenticated,
    retry: false,
  }) as any;

  // Handle both paginated response { data: [...] } and legacy plain array
  const patients = Array.isArray(patientsResponse) ? patientsResponse : patientsResponse?.data || patientsResponse;

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

  // Bulk eligibility check mutation
  const [sendingPortalLink, setSendingPortalLink] = useState<number | null>(null);
  const sendPortalLinkMutation = useMutation({
    mutationFn: async (patientId: number) => {
      setSendingPortalLink(patientId);
      const response = await apiRequest("POST", `/api/patients/${patientId}/send-portal-link`);
      return response.json();
    },
    onSuccess: (data) => {
      setSendingPortalLink(null);
      toast({
        title: "Portal Link Sent",
        description: data.message || "Patient will receive an email with their portal access link.",
      });
    },
    onError: (error) => {
      setSendingPortalLink(null);
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({
        title: "Failed to Send",
        description: error instanceof Error ? error.message : "Could not send portal link. Make sure the patient has an email address.",
        variant: "destructive",
      });
    },
  });

  const bulkEligibilityMutation = useMutation({
    mutationFn: async (patientIds: number[]) => {
      setBulkCheckInProgress(true);
      setBulkCheckTotal(patientIds.length);
      setBulkCheckProgress(0);
      setBulkCheckResults(null);
      setShowBulkResultsDialog(true);

      const response = await apiRequest("POST", "/api/patients/bulk-eligibility", { patientIds });
      const data = await response.json();
      return data;
    },
    onSuccess: (data) => {
      setBulkCheckInProgress(false);
      setBulkCheckProgress(data.summary.checked);
      setBulkCheckResults(data);

      // Update local eligibility results cache
      if (data.results) {
        const newResults: Record<number, EligibilityCheck> = {};
        for (const r of data.results) {
          if (r.eligibility) {
            newResults[r.patientId] = r.eligibility;
          }
        }
        setEligibilityResults(prev => ({ ...prev, ...newResults }));
      }

      // Invalidate eligibility queries for all checked patients
      for (const pid of Array.from(selectedPatientIds)) {
        queryClient.invalidateQueries({ queryKey: [`/api/patients/${pid}/eligibility`] });
      }

      setSelectedPatientIds(new Set());

      toast({
        title: "Bulk Eligibility Check Complete",
        description: `${data.summary.eligible} eligible, ${data.summary.ineligible} ineligible, ${data.summary.errors} errors out of ${data.summary.checked} checked`,
      });
    },
    onError: (error) => {
      setBulkCheckInProgress(false);
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: "Failed to run bulk eligibility checks", variant: "destructive" });
    },
  });

  // Toggle patient selection for bulk checks
  const togglePatientSelection = (patientId: number) => {
    setSelectedPatientIds(prev => {
      const next = new Set(prev);
      if (next.has(patientId)) {
        next.delete(patientId);
      } else {
        next.add(patientId);
      }
      return next;
    });
  };

  // Select/deselect all filtered patients with insurance
  const toggleSelectAll = (currentFilteredPatients: any[]) => {
    const insuredPatients = currentFilteredPatients?.filter((p: any) => p.insuranceProvider) || [];
    const allSelected = insuredPatients.length > 0 && insuredPatients.every((p: any) => selectedPatientIds.has(p.id));
    if (allSelected) {
      setSelectedPatientIds(new Set());
    } else {
      setSelectedPatientIds(new Set(insuredPatients.map((p: any) => p.id)));
    }
  };

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
      <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
        {/* Header skeleton */}
        <div className="flex items-center justify-between mb-6 md:mb-8">
          <div>
            <Skeleton className="h-7 md:h-8 w-40 md:w-48 mb-2" />
            <Skeleton className="h-4 w-56 md:w-72" />
          </div>
          <Skeleton className="h-10 w-28 md:w-32 rounded-md" />
        </div>

        {/* Search skeleton */}
        <div className="mb-4 md:mb-6">
          <Skeleton className="h-10 w-full rounded-md" />
        </div>

        {/* Stats cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-6 md:mb-8">
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
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
      <div className="flex items-center justify-between mb-6 md:mb-8 gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Patient Management</h1>
          <p className="text-sm md:text-base text-muted-foreground">Manage patient information and insurance details</p>
        </div>
        <Dialog open={showIntakeDialog} onOpenChange={setShowIntakeDialog}>
          <DialogTrigger asChild>
            <Button className="bg-medical-blue-500 hover:bg-medical-blue-600 flex-shrink-0 min-h-[44px]">
              <Plus className="w-4 h-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Add Patient</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Patient Intake Form</DialogTitle>
              <DialogDescription>
                Add a new patient with insurance information
              </DialogDescription>
            </DialogHeader>
            <PatientIntakeForm
              practiceId={practiceId}
              onSuccess={handlePatientCreated}
              startStep={2}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Search and Bulk Actions - sticky on mobile */}
      <div className="sticky top-14 md:static z-20 bg-background -mx-4 px-4 py-2 md:mx-0 md:px-0 md:py-0 border-b md:border-b-0 border-border mb-4 md:mb-6">
        <div className="flex items-center gap-2 md:space-x-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search patients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 min-h-[44px]"
            />
          </div>
          {selectedPatientIds.size > 0 && (
            <Button
              onClick={() => bulkEligibilityMutation.mutate(Array.from(selectedPatientIds))}
              disabled={bulkCheckInProgress}
              className="bg-medical-blue-500 hover:bg-medical-blue-600 whitespace-nowrap min-h-[44px] text-xs md:text-sm"
            >
              {bulkCheckInProgress ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 md:mr-2 animate-spin" />
                  <span className="hidden sm:inline">Checking...</span>
                </>
              ) : (
                <>
                  <ListChecks className="w-4 h-4 mr-1 md:mr-2" />
                  <span className="hidden sm:inline">Check Eligibility ({selectedPatientIds.size})</span>
                  <span className="sm:hidden">Check ({selectedPatientIds.size})</span>
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3 md:gap-6 mb-6 md:mb-8">
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

      {/* Select All / Bulk Actions Bar */}
      {filteredPatients?.length > 0 && (
        <div className="flex items-center gap-3 mb-4 px-1">
          <Checkbox
            id="select-all"
            checked={
              filteredPatients.filter((p: any) => p.insuranceProvider).length > 0 &&
              filteredPatients.filter((p: any) => p.insuranceProvider).every((p: any) => selectedPatientIds.has(p.id))
            }
            onCheckedChange={() => toggleSelectAll(filteredPatients)}
          />
          <label htmlFor="select-all" className="text-sm text-muted-foreground cursor-pointer select-none">
            Select all insured patients ({filteredPatients.filter((p: any) => p.insuranceProvider).length})
          </label>
        </div>
      )}

      {/* Patients Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
        {filteredPatients?.length ? (
          filteredPatients.map((patient: any) => (
            <Card key={patient.id} className={`hover:shadow-lg transition-shadow ${selectedPatientIds.has(patient.id) ? 'ring-2 ring-medical-blue-500' : ''}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {patient.insuranceProvider && (
                      <Checkbox
                        checked={selectedPatientIds.has(patient.id)}
                        onCheckedChange={() => togglePatientSelection(patient.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
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
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline">
                      {patient.insuranceProvider || "No Insurance"}
                    </Badge>
                    {patient.secondaryInsuranceProvider && (
                      <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                        2nd: {patient.secondaryInsuranceProvider}
                      </Badge>
                    )}
                    {getEligibilityBadge(patient.id)}
                    {patient.intakeCompletedAt ? (
                      <Badge className="bg-green-50 text-green-700 border-green-200 text-xs">
                        <ClipboardCheck className="w-3 h-3 mr-1" />
                        Intake Done
                      </Badge>
                    ) : patient.intakeData ? (
                      <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200 text-xs">
                        <ClipboardCheck className="w-3 h-3 mr-1" />
                        Intake Started
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {patient.email && (
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Mail className="w-4 h-4 mr-2" />
                      {patient.email}
                    </div>
                  )}
                  {patient.phone && (
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Phone className="w-4 h-4 mr-2" />
                      {patient.phone}
                    </div>
                  )}
                  {patient.insuranceId && (
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Shield className="w-4 h-4 mr-2" />
                      ID: {patient.insuranceId}
                    </div>
                  )}
                </div>
                
                <div className="mt-4 flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 min-h-[44px]"
                    onClick={() => setSelectedPatient(patient)}
                  >
                    View Details
                  </Button>
                  {patient.insuranceProvider && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={() => checkEligibilityMutation.mutate({
                        patientId: patient.id,
                      })}
                      disabled={checkingEligibility === patient.id}
                    >
                      {checkingEligibility === patient.id ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          <span className="hidden sm:inline">Checking...</span>
                        </>
                      ) : (
                        <>
                          <Shield className="w-4 h-4 mr-1" />
                          <span className="hidden sm:inline">Check Eligibility</span>
                          <span className="sm:hidden">Check</span>
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

      {/* Bulk Eligibility Progress/Results Dialog */}
      <Dialog open={showBulkResultsDialog} onOpenChange={(open) => { if (!bulkCheckInProgress) setShowBulkResultsDialog(open); }}>
        <DialogContent className="sm:max-w-[550px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {bulkCheckInProgress ? "Checking Eligibility..." : "Bulk Eligibility Results"}
            </DialogTitle>
            <DialogDescription>
              {bulkCheckInProgress
                ? `Verifying insurance eligibility for ${bulkCheckTotal} patients`
                : bulkCheckResults
                  ? `Completed: ${bulkCheckResults.summary.checked} patients checked`
                  : ""}
            </DialogDescription>
          </DialogHeader>

          {bulkCheckInProgress && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-medical-blue-500" />
                <span className="text-sm text-muted-foreground">Processing eligibility checks...</span>
              </div>
              <Progress value={0} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                This may take a moment. Please do not close this dialog.
              </p>
            </div>
          )}

          {!bulkCheckInProgress && bulkCheckResults && (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-2xl font-bold text-foreground">{bulkCheckResults.summary.checked}</p>
                  <p className="text-xs text-muted-foreground">Checked</p>
                </div>
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <p className="text-2xl font-bold text-green-700">{bulkCheckResults.summary.eligible}</p>
                  <p className="text-xs text-green-600">Eligible</p>
                </div>
                <div className="text-center p-3 bg-red-50 rounded-lg">
                  <p className="text-2xl font-bold text-red-700">{bulkCheckResults.summary.ineligible}</p>
                  <p className="text-xs text-red-600">Ineligible</p>
                </div>
                <div className="text-center p-3 bg-yellow-50 rounded-lg">
                  <p className="text-2xl font-bold text-yellow-700">{bulkCheckResults.summary.errors}</p>
                  <p className="text-xs text-yellow-600">Errors</p>
                </div>
              </div>

              {/* Individual Results */}
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {bulkCheckResults.results.map((result) => (
                  <div key={result.patientId} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-medium text-foreground">{result.patientName}</span>
                    <div>
                      {result.status === 'active' && (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Eligible
                        </Badge>
                      )}
                      {result.status === 'inactive' && (
                        <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                          <XCircle className="w-3 h-3 mr-1" />
                          Inactive
                        </Badge>
                      )}
                      {result.status === 'unknown' && (
                        <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Unknown
                        </Badge>
                      )}
                      {result.status === 'error' && (
                        <Badge className="bg-red-100 text-red-700 hover:bg-red-100" title={result.error}>
                          <XCircle className="w-3 h-3 mr-1" />
                          Error
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setShowBulkResultsDialog(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Patient Details Modal - full-screen on mobile */}
      {selectedPatient && (
        <Dialog open={!!selectedPatient} onOpenChange={() => setSelectedPatient(null)}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedPatient.firstName} {selectedPatient.lastName}
              </DialogTitle>
              <DialogDescription>
                Patient details, insurance, and billing
              </DialogDescription>
              <div className="flex gap-2 mt-2">
                {selectedPatient.email && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => sendPortalLinkMutation.mutate(selectedPatient.id)}
                    disabled={sendingPortalLink === selectedPatient.id}
                  >
                    {sendingPortalLink === selectedPatient.id ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-1" />
                    )}
                    Send Portal Link
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/patient-portal?demo=true`, '_blank')}
                >
                  <ExternalLink className="w-4 h-4 mr-1" />
                  Preview Portal
                </Button>
              </div>
            </DialogHeader>
            <Tabs defaultValue="details" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="intake" className="relative">
                  Intake
                  {selectedPatient.intakeCompletedAt && (
                    <span className="ml-1 w-2 h-2 bg-green-500 rounded-full inline-block" />
                  )}
                </TabsTrigger>
                <TabsTrigger value="billing">Billing</TabsTrigger>
                <TabsTrigger value="progress-notes">Notes</TabsTrigger>
              </TabsList>

              <TabsContent value="billing" className="mt-4">
                <PatientBillingTab
                  patientId={selectedPatient.id}
                  patientName={`${selectedPatient.firstName} ${selectedPatient.lastName}`}
                />
              </TabsContent>

              <TabsContent value="intake" className="mt-4">
                <PatientIntakeDataView patient={selectedPatient} />
              </TabsContent>

              <TabsContent value="details" className="mt-4">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground">Email</label>
                  <p className="text-sm text-muted-foreground">{selectedPatient.email || "Not provided"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Phone</label>
                  <p className="text-sm text-muted-foreground">{selectedPatient.phone || "Not provided"}</p>
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground">Date of Birth</label>
                <p className="text-sm text-muted-foreground">
                  {selectedPatient.dateOfBirth 
                    ? new Date(selectedPatient.dateOfBirth).toLocaleDateString()
                    : "Not provided"
                  }
                </p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground">Address</label>
                <p className="text-sm text-muted-foreground">{selectedPatient.address || "Not provided"}</p>
              </div>
              
              <div className="border-t pt-4">
                <h4 className="font-medium text-foreground mb-2">Insurance Information</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-foreground">Provider</label>
                    <p className="text-sm text-muted-foreground">{selectedPatient.insuranceProvider || "Not provided"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">Member ID</label>
                    <p className="text-sm text-muted-foreground">{selectedPatient.insuranceId || "Not provided"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <label className="text-sm font-medium text-foreground">Policy Number</label>
                    <p className="text-sm text-muted-foreground">{selectedPatient.policyNumber || "Not provided"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">Group Number</label>
                    <p className="text-sm text-muted-foreground">{selectedPatient.groupNumber || "Not provided"}</p>
                  </div>
                </div>
              </div>

              {/* Secondary Insurance */}
              {selectedPatient.secondaryInsuranceProvider && (
                <div className="border-t pt-4">
                  <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-purple-600" />
                    Secondary Insurance
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-foreground">Provider</label>
                      <p className="text-sm text-muted-foreground">{selectedPatient.secondaryInsuranceProvider}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Member ID</label>
                      <p className="text-sm text-muted-foreground">{selectedPatient.secondaryInsuranceMemberId || "Not provided"}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <div>
                      <label className="text-sm font-medium text-foreground">Policy Number</label>
                      <p className="text-sm text-muted-foreground">{selectedPatient.secondaryInsurancePolicyNumber || "Not provided"}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Group Number</label>
                      <p className="text-sm text-muted-foreground">{selectedPatient.secondaryInsuranceGroupNumber || "Not provided"}</p>
                    </div>
                  </div>
                  {selectedPatient.secondaryInsuranceRelationship && (
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div>
                        <label className="text-sm font-medium text-foreground">Relationship</label>
                        <p className="text-sm text-muted-foreground capitalize">{selectedPatient.secondaryInsuranceRelationship}</p>
                      </div>
                      {selectedPatient.secondaryInsuranceSubscriberName && (
                        <div>
                          <label className="text-sm font-medium text-foreground">Subscriber Name</label>
                          <p className="text-sm text-muted-foreground">{selectedPatient.secondaryInsuranceSubscriberName}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Insurance Card Images */}
              {(insuranceCards?.front || insuranceCards?.back) && (
                <div className="border-t pt-4">
                  <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-blue-600" />
                    Insurance Card
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {insuranceCards.front && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Front</label>
                        <div className="border rounded-lg overflow-hidden bg-muted/30">
                          <img
                            src={insuranceCards.front}
                            alt="Insurance card front"
                            className="w-full h-auto object-contain max-h-48 cursor-pointer"
                            onClick={() => window.open(insuranceCards.front, '_blank')}
                            title="Click to view full size"
                          />
                        </div>
                      </div>
                    )}
                    {insuranceCards.back && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Back</label>
                        <div className="border rounded-lg overflow-hidden bg-muted/30">
                          <img
                            src={insuranceCards.back}
                            alt="Insurance card back"
                            className="w-full h-auto object-contain max-h-48 cursor-pointer"
                            onClick={() => window.open(insuranceCards.back, '_blank')}
                            title="Click to view full size"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  {insuranceCards.uploadedAt && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Uploaded {new Date(insuranceCards.uploadedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}

              {/* Benefits Verification Card */}
              <div className="border-t pt-4">
                <BenefitsVerificationCard
                  patientId={selectedPatient.id}
                  patientName={`${selectedPatient.firstName} ${selectedPatient.lastName}`}
                  insuranceProvider={selectedPatient.insuranceProvider}
                />
              </div>

              {/* Insurance Documents Upload */}
              <div className="border-t pt-4">
                <InsuranceDocumentsSection patientId={selectedPatient.id} />
              </div>

              {/* Admin-Only: Plan Document Upload & Parsed Benefits */}
              {isAdmin && (
                <div className="border-t pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="w-4 h-4 text-blue-600" />
                    <h4 className="font-medium text-foreground">Plan Document Analysis</h4>
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
                          <span className="text-sm font-medium text-foreground">Plan Benefits Extracted</span>
                        </div>
                        {planBenefitsData.benefits.verifiedAt && (
                          <Badge className="bg-green-100 text-green-700">Verified</Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">OON Deductible:</span>
                          <span className="ml-2 font-medium">${planBenefitsData.benefits.oonDeductibleIndividual || '—'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">OON Coinsurance:</span>
                          <span className="ml-2 font-medium">{planBenefitsData.benefits.oonCoinsurancePercent || '—'}%</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">OON OOP Max:</span>
                          <span className="ml-2 font-medium">${planBenefitsData.benefits.oonOutOfPocketMax || '—'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Allowed Amt Method:</span>
                          <span className="ml-2 font-medium capitalize">{planBenefitsData.benefits.allowedAmountMethod?.replace('_', ' ') || '—'}</span>
                        </div>
                        {planBenefitsData.benefits.allowedAmountPercent && (
                          <div>
                            <span className="text-muted-foreground">Medicare %:</span>
                            <span className="ml-2 font-medium">{planBenefitsData.benefits.allowedAmountPercent}%</span>
                          </div>
                        )}
                        {planBenefitsData.benefits.mentalHealthVisitLimit && (
                          <div>
                            <span className="text-muted-foreground">MH Visit Limit:</span>
                            <span className="ml-2 font-medium">{planBenefitsData.benefits.mentalHealthVisitLimit}/year</span>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Confidence: {Math.round((planBenefitsData.benefits.extractionConfidence || 0.7) * 100)}%
                        {planBenefitsData.benefits.planName && ` | Plan: ${planBenefitsData.benefits.planName}`}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 mb-4">
                      <p className="text-sm text-muted-foreground mb-3">
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
                    <h4 className="font-medium text-foreground">Out-of-Network Reimbursement Estimate</h4>
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                      Admin Only
                    </Badge>
                    {oonEstimate?.hasPatientPlanData && (
                      <Badge className="bg-blue-100 text-blue-700 text-xs">Using Plan Data</Badge>
                    )}
                  </div>

                  {loadingOonEstimate ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-sm text-muted-foreground">Calculating estimate...</span>
                    </div>
                  ) : oonEstimate?.prediction ? (
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-100">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Expected Allowed</p>
                          <p className="text-xl font-bold text-green-700">
                            ${oonEstimate.prediction.estimatedAllowedAmount?.toFixed(2) || '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Est. Reimbursement</p>
                          <p className="text-xl font-bold text-emerald-700">
                            ${oonEstimate.prediction.estimatedReimbursement?.toFixed(2) || '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Patient Responsibility</p>
                          <p className="text-lg font-semibold text-amber-700">
                            ${oonEstimate.prediction.estimatedPatientResponsibility?.toFixed(2) || '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Confidence</p>
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
                        <p className="text-xs text-muted-foreground">
                          <strong>CPT:</strong> 90837 (60-min therapy) |
                          <strong> Payer:</strong> {selectedPatient.insuranceProvider} |
                          <strong> Method:</strong> {oonEstimate.prediction.methodology?.replace('_', ' ') || 'Medicare multiplier'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 rounded-lg p-4 text-center">
                      <p className="text-sm text-muted-foreground">Unable to calculate OON estimate</p>
                    </div>
                  )}
                </div>
              )}
            </div>
              </TabsContent>

              <TabsContent value="progress-notes" className="mt-4">
                <PatientProgressNotesManager patientId={selectedPatient.id} />
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
