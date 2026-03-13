import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  Circle,
  Building2,
  UserPlus,
  Users,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  ClipboardList,
  Stethoscope,
  FileText,
  CreditCard,
  Zap,
  ExternalLink,
  SkipForward,
} from "lucide-react";

interface OnboardingStatus {
  step: number;
  completed: boolean;
}

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  required: boolean;
}

interface ChecklistResponse {
  checklist: ChecklistItem[];
  progress: number;
  completedRequired: number;
  totalRequired: number;
  allRequiredComplete: boolean;
}

const TOTAL_STEPS = 5;

export default function OnboardingWizard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  // Form state for each step
  const [practiceForm, setPracticeForm] = useState({
    name: "",
    specialty: "",
    providerCount: "",
  });
  const [practiceInfoForm, setPracticeInfoForm] = useState({
    address: "",
    phone: "",
    npi: "",
    taxId: "",
    taxonomyCode: "",
  });
  const [therapistForm, setTherapistForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    credentials: "",
  });
  const [patientForm, setPatientForm] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    email: "",
    phone: "",
  });

  // Fetch onboarding status
  const { data: status } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
  });

  const { data: checklist } = useQuery<ChecklistResponse>({
    queryKey: ["/api/onboarding/checklist"],
  });

  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (status && !status.completed) {
      setCurrentStep(status.step);
    }
  }, [status]);

  // Mutations
  const updateStepMutation = useMutation({
    mutationFn: async (step: number) => {
      const res = await fetch("/api/onboarding/step", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update step");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to complete onboarding");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/checklist"] });
    },
  });

  const savePracticeMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await fetch("/api/practices/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to save practice info");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/checklist"] });
    },
  });

  const inviteTherapistMutation = useMutation({
    mutationFn: async (data: typeof therapistForm) => {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          role: "therapist",
          firstName: data.firstName,
          lastName: data.lastName,
        }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to invite therapist");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/checklist"] });
      toast({
        title: t("onboarding.therapistInvited"),
        description: t("onboarding.therapistInvitedDesc"),
      });
    },
  });

  const addPatientMutation = useMutation({
    mutationFn: async (data: typeof patientForm) => {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          dateOfBirth: data.dateOfBirth || undefined,
          email: data.email || undefined,
          phone: data.phone || undefined,
          practiceId: 1,
        }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to add patient");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/checklist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      toast({
        title: t("onboarding.patientAdded"),
        description: t("onboarding.patientAddedDesc"),
      });
    },
  });

  const goToStep = (step: number) => {
    setCurrentStep(step);
    updateStepMutation.mutate(step);
  };

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      goToStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    completeMutation.mutate(undefined, {
      onSuccess: () => {
        navigate("/");
      },
    });
  };

  const handleSaveWelcome = async () => {
    if (practiceForm.name) {
      await savePracticeMutation.mutateAsync({ name: practiceForm.name });
    }
    handleNext();
  };

  const handleSavePracticeInfo = async () => {
    const data: Record<string, string> = {};
    if (practiceInfoForm.address) data.address = practiceInfoForm.address;
    if (practiceInfoForm.phone) data.phone = practiceInfoForm.phone;
    if (practiceInfoForm.npi) data.npi = practiceInfoForm.npi;
    if (practiceInfoForm.taxId) data.taxId = practiceInfoForm.taxId;
    if (Object.keys(data).length > 0) {
      await savePracticeMutation.mutateAsync(data);
    }
    handleNext();
  };

  const handleInviteTherapist = async () => {
    if (therapistForm.email && therapistForm.firstName && therapistForm.lastName) {
      await inviteTherapistMutation.mutateAsync(therapistForm);
    }
    handleNext();
  };

  const handleAddPatient = async () => {
    if (patientForm.firstName && patientForm.lastName) {
      await addPatientMutation.mutateAsync(patientForm);
    }
    handleNext();
  };

  const steps = [
    { label: t("onboarding.stepWelcome"), icon: Sparkles },
    { label: t("onboarding.stepPracticeInfo"), icon: Building2 },
    { label: t("onboarding.stepTherapist"), icon: UserPlus },
    { label: t("onboarding.stepPatient"), icon: Users },
    { label: t("onboarding.stepReady"), icon: CheckCircle },
  ];

  const getChecklistIcon = (id: string) => {
    switch (id) {
      case "practice_info": return Building2;
      case "therapist": return Stethoscope;
      case "patient": return Users;
      case "insurance": return FileText;
      case "claim": return ClipboardList;
      case "payment_settings": return CreditCard;
      case "stedi": return Zap;
      default: return Circle;
    }
  };

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
      <div className="max-w-3xl mx-auto">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = index === currentStep;
              const isCompleted = index < currentStep;
              return (
                <div key={index} className="flex flex-col items-center flex-1">
                  <button
                    onClick={() => goToStep(index)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                      isCompleted
                        ? "bg-green-500 text-white"
                        : isActive
                        ? "bg-blue-600 text-white"
                        : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                  </button>
                  <span
                    className={`text-xs mt-1 text-center hidden md:block ${
                      isActive ? "text-blue-600 font-medium" : "text-slate-500"
                    }`}
                  >
                    {step.label}
                  </span>
                  {index < steps.length - 1 && (
                    <div
                      className={`hidden md:block absolute h-0.5 w-full ${
                        isCompleted ? "bg-green-500" : "bg-slate-200"
                      }`}
                      style={{ display: "none" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* Progress bar track */}
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(currentStep / (TOTAL_STEPS - 1)) * 100}%` }}
            />
          </div>
          <p className="text-sm text-slate-500 mt-2 text-center">
            {t("onboarding.stepOf", { current: currentStep + 1, total: TOTAL_STEPS })}
          </p>
        </div>

        {/* Step Content */}
        {currentStep === 0 && (
          <Card>
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <Sparkles className="w-8 h-8 text-blue-600" />
              </div>
              <CardTitle className="text-2xl">
                {t("onboarding.welcomeTitle")}
              </CardTitle>
              <CardDescription className="text-base mt-2">
                {t("onboarding.welcomeDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div>
                <Label htmlFor="practiceName">{t("onboarding.practiceName")}</Label>
                <Input
                  id="practiceName"
                  value={practiceForm.name}
                  onChange={(e) => setPracticeForm({ ...practiceForm, name: e.target.value })}
                  placeholder={t("onboarding.practiceNamePlaceholder")}
                />
              </div>
              <div>
                <Label htmlFor="specialty">{t("onboarding.specialty")}</Label>
                <Input
                  id="specialty"
                  value={practiceForm.specialty}
                  onChange={(e) => setPracticeForm({ ...practiceForm, specialty: e.target.value })}
                  placeholder={t("onboarding.specialtyPlaceholder")}
                />
              </div>
              <div>
                <Label htmlFor="providerCount">{t("onboarding.providerCount")}</Label>
                <Input
                  id="providerCount"
                  type="number"
                  min="1"
                  value={practiceForm.providerCount}
                  onChange={(e) => setPracticeForm({ ...practiceForm, providerCount: e.target.value })}
                  placeholder={t("onboarding.providerCountPlaceholder")}
                />
              </div>
              <div className="flex justify-end pt-4">
                <Button onClick={handleSaveWelcome} className="gap-2">
                  {t("common.next")} <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {currentStep === 1 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <CardTitle>{t("onboarding.practiceInfoTitle")}</CardTitle>
                  <CardDescription>{t("onboarding.practiceInfoDesc")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="address">{t("onboarding.address")}</Label>
                <Input
                  id="address"
                  value={practiceInfoForm.address}
                  onChange={(e) => setPracticeInfoForm({ ...practiceInfoForm, address: e.target.value })}
                  placeholder={t("onboarding.addressPlaceholder")}
                />
              </div>
              <div>
                <Label htmlFor="phone">{t("onboarding.phone")}</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={practiceInfoForm.phone}
                  onChange={(e) => setPracticeInfoForm({ ...practiceInfoForm, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="npi">{t("onboarding.npi")}</Label>
                  <Input
                    id="npi"
                    value={practiceInfoForm.npi}
                    onChange={(e) => setPracticeInfoForm({ ...practiceInfoForm, npi: e.target.value })}
                    placeholder="1234567890"
                    maxLength={10}
                  />
                </div>
                <div>
                  <Label htmlFor="taxId">{t("onboarding.taxId")}</Label>
                  <Input
                    id="taxId"
                    value={practiceInfoForm.taxId}
                    onChange={(e) => setPracticeInfoForm({ ...practiceInfoForm, taxId: e.target.value })}
                    placeholder="12-3456789"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="taxonomyCode">{t("onboarding.taxonomyCode")}</Label>
                <Input
                  id="taxonomyCode"
                  value={practiceInfoForm.taxonomyCode}
                  onChange={(e) => setPracticeInfoForm({ ...practiceInfoForm, taxonomyCode: e.target.value })}
                  placeholder="225X00000X"
                />
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={handleBack} className="gap-2">
                  <ArrowLeft className="w-4 h-4" /> {t("common.back")}
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={handleNext} className="gap-2">
                    <SkipForward className="w-4 h-4" /> {t("onboarding.skip")}
                  </Button>
                  <Button onClick={handleSavePracticeInfo} className="gap-2">
                    {t("common.next")} <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {currentStep === 2 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <UserPlus className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <CardTitle>{t("onboarding.therapistTitle")}</CardTitle>
                  <CardDescription>{t("onboarding.therapistDesc")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="therapistFirstName">{t("onboarding.firstName")}</Label>
                  <Input
                    id="therapistFirstName"
                    value={therapistForm.firstName}
                    onChange={(e) => setTherapistForm({ ...therapistForm, firstName: e.target.value })}
                    placeholder={t("onboarding.firstNamePlaceholder")}
                  />
                </div>
                <div>
                  <Label htmlFor="therapistLastName">{t("onboarding.lastName")}</Label>
                  <Input
                    id="therapistLastName"
                    value={therapistForm.lastName}
                    onChange={(e) => setTherapistForm({ ...therapistForm, lastName: e.target.value })}
                    placeholder={t("onboarding.lastNamePlaceholder")}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="therapistEmail">{t("onboarding.email")}</Label>
                <Input
                  id="therapistEmail"
                  type="email"
                  value={therapistForm.email}
                  onChange={(e) => setTherapistForm({ ...therapistForm, email: e.target.value })}
                  placeholder="therapist@practice.com"
                />
              </div>
              <div>
                <Label htmlFor="therapistCredentials">{t("onboarding.credentials")}</Label>
                <Input
                  id="therapistCredentials"
                  value={therapistForm.credentials}
                  onChange={(e) => setTherapistForm({ ...therapistForm, credentials: e.target.value })}
                  placeholder={t("onboarding.credentialsPlaceholder")}
                />
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={handleBack} className="gap-2">
                  <ArrowLeft className="w-4 h-4" /> {t("common.back")}
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={handleNext} className="gap-2">
                    <SkipForward className="w-4 h-4" /> {t("onboarding.skip")}
                  </Button>
                  <Button onClick={handleInviteTherapist} className="gap-2">
                    {t("onboarding.inviteAndContinue")} <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {currentStep === 3 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <CardTitle>{t("onboarding.patientTitle")}</CardTitle>
                  <CardDescription>{t("onboarding.patientDesc")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="patientFirstName">{t("onboarding.firstName")}</Label>
                  <Input
                    id="patientFirstName"
                    value={patientForm.firstName}
                    onChange={(e) => setPatientForm({ ...patientForm, firstName: e.target.value })}
                    placeholder={t("onboarding.firstNamePlaceholder")}
                  />
                </div>
                <div>
                  <Label htmlFor="patientLastName">{t("onboarding.lastName")}</Label>
                  <Input
                    id="patientLastName"
                    value={patientForm.lastName}
                    onChange={(e) => setPatientForm({ ...patientForm, lastName: e.target.value })}
                    placeholder={t("onboarding.lastNamePlaceholder")}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="patientDob">{t("onboarding.dateOfBirth")}</Label>
                <Input
                  id="patientDob"
                  type="date"
                  value={patientForm.dateOfBirth}
                  onChange={(e) => setPatientForm({ ...patientForm, dateOfBirth: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="patientEmail">{t("onboarding.email")}</Label>
                <Input
                  id="patientEmail"
                  type="email"
                  value={patientForm.email}
                  onChange={(e) => setPatientForm({ ...patientForm, email: e.target.value })}
                  placeholder="patient@email.com"
                />
              </div>
              <div>
                <Label htmlFor="patientPhone">{t("onboarding.patientPhone")}</Label>
                <Input
                  id="patientPhone"
                  type="tel"
                  value={patientForm.phone}
                  onChange={(e) => setPatientForm({ ...patientForm, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={handleBack} className="gap-2">
                  <ArrowLeft className="w-4 h-4" /> {t("common.back")}
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={handleNext} className="gap-2">
                    <SkipForward className="w-4 h-4" /> {t("onboarding.skip")}
                  </Button>
                  <Button onClick={handleAddPatient} className="gap-2">
                    {t("onboarding.addAndContinue")} <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {currentStep === 4 && (
          <Card>
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <CardTitle className="text-2xl">
                {t("onboarding.readyTitle")}
              </CardTitle>
              <CardDescription className="text-base mt-2">
                {t("onboarding.readyDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              {/* Checklist summary */}
              {checklist && (
                <div className="space-y-3 mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700">
                      {t("onboarding.setupProgress")}
                    </span>
                    <span className="text-sm text-slate-500">
                      {checklist.completedRequired}/{checklist.totalRequired}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2 mb-4">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${checklist.progress}%` }}
                    />
                  </div>
                  {checklist.checklist.map((item) => {
                    const Icon = getChecklistIcon(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border ${
                          item.completed
                            ? "bg-green-50 border-green-200"
                            : "bg-slate-50 border-slate-200"
                        }`}
                      >
                        {item.completed ? (
                          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                        ) : (
                          <Circle className="w-5 h-5 text-slate-300 flex-shrink-0" />
                        )}
                        <Icon className="w-4 h-4 text-slate-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${item.completed ? "text-green-700" : "text-slate-700"}`}>
                            {item.label}
                          </p>
                          <p className="text-xs text-slate-500">{item.description}</p>
                        </div>
                        {!item.required && (
                          <span className="text-xs text-slate-400 flex-shrink-0">
                            {t("onboarding.optional")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Quick links */}
              <div className="border-t pt-4 mt-4">
                <h3 className="text-sm font-medium text-slate-700 mb-3">
                  {t("onboarding.quickLinks")}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <QuickLink href="/patients" label={t("onboarding.linkPatients")} />
                  <QuickLink href="/calendar" label={t("onboarding.linkCalendar")} />
                  <QuickLink href="/claims" label={t("onboarding.linkClaims")} />
                  <QuickLink href="/soap-notes" label={t("onboarding.linkSoapNotes")} />
                  <QuickLink href="/settings" label={t("onboarding.linkSettings")} />
                  <QuickLink href="/payer-management" label={t("onboarding.linkPayers")} />
                </div>
              </div>

              <div className="flex justify-between pt-6">
                <Button variant="outline" onClick={handleBack} className="gap-2">
                  <ArrowLeft className="w-4 h-4" /> {t("common.back")}
                </Button>
                <Button onClick={handleComplete} className="gap-2" size="lg">
                  {t("onboarding.goToDashboard")} <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 p-2 rounded-md hover:bg-slate-100 text-sm text-blue-600 hover:text-blue-700 transition-colors"
    >
      <ExternalLink className="w-3.5 h-3.5" />
      {label}
    </a>
  );
}
