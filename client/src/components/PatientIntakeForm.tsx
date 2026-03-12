import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Upload, FileText, CheckCircle, Loader2, Info, Shield, FileSignature, CreditCard } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

// Sensory processing question options
const FREQUENCY_OPTIONS = ["Never", "Rarely", "Sometimes", "Often", "Always"];

const patientSchema = z.object({
  // Basic Patient Info
  firstName: z.string().min(1, "First name is required"),
  middleName: z.string().optional(),
  lastName: z.string().min(1, "Last name is required"),
  nickname: z.string().optional(),
  dateOfBirth: z.string().optional(),
  sex: z.string().optional(),
  gender: z.string().optional(),
  ssn: z.string().optional(),
  race: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),

  // School Info
  schoolName: z.string().optional(),
  schoolGrade: z.string().optional(),
  teacherName: z.string().optional(),
  schoolConcerns: z.string().optional(),

  // Insurance
  insuranceProvider: z.string().optional(),
  insuranceId: z.string().optional(),
  policyNumber: z.string().optional(),
  groupNumber: z.string().optional(),

  // Parent 1
  parent1Name: z.string().optional(),
  parent1Address: z.string().optional(),
  parent1City: z.string().optional(),
  parent1State: z.string().optional(),
  parent1Zip: z.string().optional(),
  parent1Email: z.string().optional(),
  parent1Phone: z.string().optional(),
  parent1Cell: z.string().optional(),
  parent1EmailReminders: z.boolean().optional(),
  parent1TextReminders: z.boolean().optional(),

  // Parent 2
  parent2Name: z.string().optional(),
  parent2Address: z.string().optional(),
  parent2Phone: z.string().optional(),
  parent2Email: z.string().optional(),

  // Emergency Contact
  emergencyName: z.string().optional(),
  emergencyPhone: z.string().optional(),
  emergencyRelationship: z.string().optional(),

  // Reason for Therapy
  mainConcerns: z.string().optional(),
  therapyGoals: z.string().optional(),

  // Birth History
  pregnancyProblems: z.string().optional(),
  pregnancyDetails: z.string().optional(),
  birthType: z.string().optional(),
  birthWeeks: z.string().optional(),
  deliveryType: z.string().optional(),
  laborLength: z.string().optional(),
  birthComplications: z.string().optional(),
  nicuStay: z.string().optional(),
  nicuDuration: z.string().optional(),

  // Medical History
  diagnosis: z.string().optional(),
  medications: z.string().optional(),
  sicknessFrequency: z.string().optional(),
  allergies: z.string().optional(),
  allergyDetails: z.string().optional(),
  hearingTested: z.string().optional(),
  hearingDetails: z.string().optional(),
  visionTested: z.string().optional(),
  visionDetails: z.string().optional(),
  surgeries: z.string().optional(),

  // Nutrition
  nutritionConcerns: z.string().optional(),
  nutritionDetails: z.string().optional(),

  // Treatment History
  previousTherapy: z.string().optional(),

  // Social History
  custodyArrangements: z.string().optional(),
  custodyDetails: z.string().optional(),
  familyDetails: z.string().optional(),
  familyMedicalHistory: z.string().optional(),
  familyImpactHistory: z.string().optional(),

  // Developmental Milestones
  milestoneHeadUp: z.string().optional(),
  milestoneRollOver: z.string().optional(),
  milestoneSitIndependently: z.string().optional(),
  milestoneCreep: z.string().optional(),
  milestoneCrawl: z.string().optional(),
  milestoneStandAlone: z.string().optional(),
  milestoneWalk: z.string().optional(),
  milestoneFirstWord: z.string().optional(),
  milestoneWave: z.string().optional(),
  milestonePoint: z.string().optional(),
  handPreference: z.string().optional(),

  // Visual & Motor Skills
  visualMotorDifficulties: z.array(z.string()).optional(),

  // Social Emotional
  socialEmotionalDifficulties: z.array(z.string()).optional(),
  otherSocialEmotional: z.string().optional(),

  // Sensory Processing (stored as JSON)
  sensoryConstantMotion: z.string().optional(),
  sensoryConstantMotionComments: z.string().optional(),
  sensoryConcentration: z.string().optional(),
  sensoryConcentrationComments: z.string().optional(),
  sensoryRunningJumping: z.string().optional(),
  sensoryRunningJumpingComments: z.string().optional(),
  sensoryBumpsInto: z.string().optional(),
  sensoryBumpsIntoComments: z.string().optional(),
  sensoryReactsToBumps: z.string().optional(),
  sensoryReactsToBumpsComments: z.string().optional(),
  sensoryMessyPlay: z.string().optional(),
  sensoryMessyPlayComments: z.string().optional(),
  sensoryHairWashing: z.string().optional(),
  sensoryHairWashingComments: z.string().optional(),
  sensoryClothing: z.string().optional(),
  sensoryClothingComments: z.string().optional(),
  sensoryLoudSounds: z.string().optional(),
  sensoryLoudSoundsComments: z.string().optional(),
  sensoryPlayground: z.string().optional(),
  sensoryPlaygroundComments: z.string().optional(),
  sensoryBalance: z.string().optional(),
  sensoryBalanceComments: z.string().optional(),
  sensoryReading: z.string().optional(),
  sensoryReadingComments: z.string().optional(),
  sensoryTracking: z.string().optional(),
  sensoryTrackingComments: z.string().optional(),
  sensoryMoodVariations: z.string().optional(),
  sensoryMoodVariationsComments: z.string().optional(),
  sensoryEyeContact: z.string().optional(),
  sensoryEyeContactComments: z.string().optional(),
  sensoryInstructions: z.string().optional(),
  sensoryInstructionsComments: z.string().optional(),
  sensoryFussyEater: z.string().optional(),
  sensoryFussyEaterComments: z.string().optional(),
  sensorySmells: z.string().optional(),
  sensorySmellsComments: z.string().optional(),
  sensoryPainThreshold: z.string().optional(),
  sensoryPainThresholdComments: z.string().optional(),

  // Consents
  hipaaConsent: z.boolean().optional(),
  hipaaSignature: z.string().optional(),
  hipaaDate: z.string().optional(),
  waiverConsent: z.boolean().optional(),
  waiverSignature: z.string().optional(),
  waiverDate: z.string().optional(),
  financialConsent: z.boolean().optional(),
  financialSignature: z.string().optional(),
  financialDate: z.string().optional(),
});

type PatientFormData = z.infer<typeof patientSchema>;

interface PatientIntakeFormProps {
  practiceId: number;
  onSuccess: () => void;
}

export default function PatientIntakeForm({ practiceId, onSuccess }: PatientIntakeFormProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [planDocument, setPlanDocument] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<string>("sbc");
  const [consentGiven, setConsentGiven] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [documentUploaded, setDocumentUploaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const totalSteps = 15;

  const form = useForm<PatientFormData>({
    mode: "onTouched",
    resolver: zodResolver(patientSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      middleName: "",
      nickname: "",
      dateOfBirth: "",
      sex: "",
      gender: "",
      email: "",
      phone: "",
      address: "",
      insuranceProvider: "",
      insuranceId: "",
      policyNumber: "",
      groupNumber: "",
      hipaaConsent: false,
      waiverConsent: false,
      financialConsent: false,
      parent1EmailReminders: true,
      parent1TextReminders: true,
    },
  });

  const createPatientMutation = useMutation({
    mutationFn: async (data: PatientFormData) => {
      // Store extended intake data as JSON
      const intakeData = {
        // School info
        schoolName: data.schoolName,
        schoolGrade: data.schoolGrade,
        teacherName: data.teacherName,
        schoolConcerns: data.schoolConcerns,
        // Parent info
        parent1: {
          name: data.parent1Name,
          address: data.parent1Address,
          city: data.parent1City,
          state: data.parent1State,
          zip: data.parent1Zip,
          email: data.parent1Email,
          phone: data.parent1Phone,
          cell: data.parent1Cell,
          emailReminders: data.parent1EmailReminders,
          textReminders: data.parent1TextReminders,
        },
        parent2: {
          name: data.parent2Name,
          address: data.parent2Address,
          phone: data.parent2Phone,
          email: data.parent2Email,
        },
        emergencyContact: {
          name: data.emergencyName,
          phone: data.emergencyPhone,
          relationship: data.emergencyRelationship,
        },
        // Therapy reason
        mainConcerns: data.mainConcerns,
        therapyGoals: data.therapyGoals,
        // Birth history
        birthHistory: {
          pregnancyProblems: data.pregnancyProblems,
          pregnancyDetails: data.pregnancyDetails,
          birthType: data.birthType,
          birthWeeks: data.birthWeeks,
          deliveryType: data.deliveryType,
          laborLength: data.laborLength,
          complications: data.birthComplications,
          nicuStay: data.nicuStay,
          nicuDuration: data.nicuDuration,
        },
        // Medical history
        medicalHistory: {
          diagnosis: data.diagnosis,
          medications: data.medications,
          sicknessFrequency: data.sicknessFrequency,
          allergies: data.allergies,
          allergyDetails: data.allergyDetails,
          hearingTested: data.hearingTested,
          hearingDetails: data.hearingDetails,
          visionTested: data.visionTested,
          visionDetails: data.visionDetails,
          surgeries: data.surgeries,
        },
        // Nutrition
        nutrition: {
          concerns: data.nutritionConcerns,
          details: data.nutritionDetails,
        },
        // Treatment history
        previousTherapy: data.previousTherapy,
        // Social history
        socialHistory: {
          custodyArrangements: data.custodyArrangements,
          custodyDetails: data.custodyDetails,
          familyDetails: data.familyDetails,
          familyMedicalHistory: data.familyMedicalHistory,
          familyImpactHistory: data.familyImpactHistory,
        },
        // Developmental milestones
        milestones: {
          headUp: data.milestoneHeadUp,
          rollOver: data.milestoneRollOver,
          sitIndependently: data.milestoneSitIndependently,
          creep: data.milestoneCreep,
          crawl: data.milestoneCrawl,
          standAlone: data.milestoneStandAlone,
          walk: data.milestoneWalk,
          firstWord: data.milestoneFirstWord,
          wave: data.milestoneWave,
          point: data.milestonePoint,
          handPreference: data.handPreference,
        },
        // Visual & motor
        visualMotorDifficulties: data.visualMotorDifficulties,
        // Social emotional
        socialEmotionalDifficulties: data.socialEmotionalDifficulties,
        otherSocialEmotional: data.otherSocialEmotional,
        // Sensory processing
        sensoryProcessing: {
          constantMotion: { response: data.sensoryConstantMotion, comments: data.sensoryConstantMotionComments },
          concentration: { response: data.sensoryConcentration, comments: data.sensoryConcentrationComments },
          runningJumping: { response: data.sensoryRunningJumping, comments: data.sensoryRunningJumpingComments },
          bumpsInto: { response: data.sensoryBumpsInto, comments: data.sensoryBumpsIntoComments },
          reactsToBumps: { response: data.sensoryReactsToBumps, comments: data.sensoryReactsToBumpsComments },
          messyPlay: { response: data.sensoryMessyPlay, comments: data.sensoryMessyPlayComments },
          hairWashing: { response: data.sensoryHairWashing, comments: data.sensoryHairWashingComments },
          clothing: { response: data.sensoryClothing, comments: data.sensoryClothingComments },
          loudSounds: { response: data.sensoryLoudSounds, comments: data.sensoryLoudSoundsComments },
          playground: { response: data.sensoryPlayground, comments: data.sensoryPlaygroundComments },
          balance: { response: data.sensoryBalance, comments: data.sensoryBalanceComments },
          reading: { response: data.sensoryReading, comments: data.sensoryReadingComments },
          tracking: { response: data.sensoryTracking, comments: data.sensoryTrackingComments },
          moodVariations: { response: data.sensoryMoodVariations, comments: data.sensoryMoodVariationsComments },
          eyeContact: { response: data.sensoryEyeContact, comments: data.sensoryEyeContactComments },
          instructions: { response: data.sensoryInstructions, comments: data.sensoryInstructionsComments },
          fussyEater: { response: data.sensoryFussyEater, comments: data.sensoryFussyEaterComments },
          smells: { response: data.sensorySmells, comments: data.sensorySmellsComments },
          painThreshold: { response: data.sensoryPainThreshold, comments: data.sensoryPainThresholdComments },
        },
        // Consents
        consents: {
          hipaa: { signed: data.hipaaConsent, signature: data.hipaaSignature, date: data.hipaaDate },
          waiver: { signed: data.waiverConsent, signature: data.waiverSignature, date: data.waiverDate },
          financial: { signed: data.financialConsent, signature: data.financialSignature, date: data.financialDate },
        },
      };

      const response = await apiRequest("POST", "/api/patients", {
        firstName: data.firstName,
        middleName: data.middleName,
        lastName: data.lastName,
        nickname: data.nickname,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth).toISOString().split('T')[0] : null,
        sex: data.sex,
        gender: data.gender,
        ssn: data.ssn,
        race: data.race,
        email: data.email,
        phone: data.phone,
        address: data.address,
        insuranceProvider: data.insuranceProvider,
        insuranceId: data.insuranceId,
        policyNumber: data.policyNumber,
        groupNumber: data.groupNumber,
        practiceId,
        intakeData: JSON.stringify(intakeData),
        intakeCompletedAt: new Date().toISOString(),
      });
      return response.json();
    },
    onSuccess: async (patient) => {
      // If a plan document was selected, upload it
      if (planDocument && consentGiven && patient?.id) {
        setUploadingDocument(true);
        try {
          const formData = new FormData();
          formData.append('document', planDocument);
          formData.append('documentType', documentType);
          formData.append('consentGiven', 'true');

          const response = await fetch(`/api/patients/${patient.id}/plan-documents/public`, {
            method: 'POST',
            body: formData,
          });

          const result = await response.json();
          if (result.success) {
            setDocumentUploaded(true);
            toast({
              title: "Insurance Document Uploaded",
              description: "Your plan benefits have been extracted successfully.",
            });
          }
        } catch (error) {
          console.error("Failed to upload document:", error);
          toast({
            title: "Document Upload Issue",
            description: "Patient created, but document processing had an issue. The office will follow up.",
            variant: "destructive",
          });
        } finally {
          setUploadingDocument(false);
        }
      }

      toast({
        title: "Registration Complete",
        description: "Patient intake form has been submitted successfully.",
      });
      onSuccess();
      form.reset();
      setStep(1);
      setPlanDocument(null);
      setConsentGiven(false);
      setDocumentUploaded(false);
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
        description: "Failed to submit intake form",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: PatientFormData) => {
    createPatientMutation.mutate(data);
  };

  const nextStep = () => {
    if (step < totalSteps) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setPlanDocument(file);
    }
  };

  // Sensory Processing Question Component
  const SensoryQuestion = ({
    question,
    fieldName,
    commentsFieldName
  }: {
    question: string;
    fieldName: keyof PatientFormData;
    commentsFieldName: keyof PatientFormData;
  }) => (
    <div className="space-y-2 p-3 bg-slate-50 rounded-lg">
      <Label className="text-sm font-medium">{question}</Label>
      <FormField
        control={form.control}
        name={fieldName}
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <RadioGroup
                onValueChange={field.onChange}
                value={field.value as string || ""}
                className="flex flex-wrap gap-2"
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <div key={option} className="flex items-center space-x-1">
                    <RadioGroupItem value={option} id={`${fieldName}-${option}`} />
                    <Label htmlFor={`${fieldName}-${option}`} className="text-xs">{option}</Label>
                  </div>
                ))}
              </RadioGroup>
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={commentsFieldName}
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <Input
                placeholder="Comments (optional)"
                {...field}
                value={field.value as string || ""}
                className="text-sm"
              />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Progress Indicator */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">
              Step {step} of {totalSteps}
            </span>
            <span className="text-sm text-slate-500">
              {step === 1 && "HIPAA Policy"}
              {step === 2 && "Patient Information"}
              {step === 3 && "Parent/Guardian 1"}
              {step === 4 && "Parent 2 & Emergency"}
              {step === 5 && "Reason for Therapy"}
              {step === 6 && "Birth History"}
              {step === 7 && "Medical History"}
              {step === 8 && "Nutrition & Treatment"}
              {step === 9 && "Social History"}
              {step === 10 && "Developmental History"}
              {step === 11 && "Sensory Processing (1/2)"}
              {step === 12 && "Sensory Processing (2/2)"}
              {step === 13 && "Waiver & Release"}
              {step === 14 && "Financial Responsibility"}
              {step === 15 && "Insurance Documents"}
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div
              className="bg-medical-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* Step 1: HIPAA Policy */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-900">HIPAA Notice of Privacy Practices</h3>
            </div>

            <ScrollArea className="h-[400px] border rounded-lg p-4 bg-slate-50">
              <div className="space-y-4 text-sm text-slate-700 pr-4">
                <p className="font-semibold">This notice describes how medical information about you may be used and disclosed and how you can get access to this information. Please review it carefully.</p>

                <p>The Health Insurance Portability & Accountability Act of 1996 (HIPAA) is a federal program that requires that all medical records and other individually identifiable health information used or disclosed by us in any form, whether electronically, on paper, or orally, are kept properly confidential.</p>

                <p>This Act gives you, the patient, significant new rights to understand and control how your health information is used. We are required by law to maintain the privacy of your protected health information and to provide you with notice of our legal duties and privacy practices with respect to protected health information. HIPAA provides penalties for covered entities that misuse personal health information.</p>

                <p className="font-semibold">Definitions:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li><strong>Treatment</strong> means providing, coordinating, or managing health care and related services, by one or more health care providers.</li>
                  <li><strong>Payment</strong> means such activities as obtaining reimbursement for services, confirming coverage, billing or collections activities, and utilization review.</li>
                  <li><strong>Health care operations</strong> include the business aspects of running our practice, such as conducting quality assessment and improvement activities, auditing functions, cost-management analysis, and customer service.</li>
                </ul>

                <p>We may create and distribute de-identified health information by removing all references to individually identifiable information.</p>

                <p>We may contact you to provide appointment reminders or information about treatment alternatives or other health-related benefits and services that may be of interest to you.</p>

                <p>Any other uses and disclosures will be made only with your written authorization. You may revoke such authorization in writing and we are required to honor and abide by that written request, except to the extent that we have already taken actions relying on your authorization.</p>

                <p className="font-semibold">Your Rights:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>The right to request restrictions on certain uses and disclosures of protected health information</li>
                  <li>The right to reasonable requests to receive confidential communications of protected health information by alternative means or at alternative locations</li>
                  <li>The right to inspect and copy your protected health information</li>
                  <li>The right to amend your protected health information</li>
                  <li>The right to obtain a paper copy of this notice upon request</li>
                </ul>

                <p>We are required to abide by the terms of the Notice of Privacy Practices currently in effect. We reserve the right to change the terms of our Notice of Privacy Practices and to make the new notice provisions effective for all protected health information that we maintain.</p>

                <p>You have recourse if you feel that your privacy protections have been violated. You have the right to file written complaints with our office, or with the Department of Health & Human Services, Office of Civil Rights, about violations of the provisions of this notice or the policies and procedures of our office.</p>

                <p className="font-semibold">We will not retaliate against you for filing a complaint.</p>

                <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
                  <p className="text-xs text-blue-800">
                    <strong>Contact for more information:</strong><br />
                    U.S. Department of Health & Human Services Office of Civil Rights<br />
                    200 Independence Avenue, S.W., Washington, D.C. 20201<br />
                    (202) 619-0257 | Toll Free: 1-877-696-6775
                  </p>
                </div>
              </div>
            </ScrollArea>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <FormField
                  control={form.control}
                  name="hipaaConsent"
                  render={({ field }) => (
                    <FormItem className="flex items-start space-x-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          I acknowledge that I have received and reviewed the Notice of Privacy Practices
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="hipaaSignature"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Signature (Type Full Name)</FormLabel>
                      <FormControl>
                        <Input placeholder="John Doe" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hipaaDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} defaultValue={new Date().toISOString().split('T')[0]} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={nextStep}
                disabled={!form.watch("hipaaConsent") || !form.watch("hipaaSignature")}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Patient Information */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Patient Information</h3>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="John" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="middleName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Middle Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Michael" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nickname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nickname</FormLabel>
                    <FormControl>
                      <Input placeholder="Johnny" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of Birth</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sex"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sex</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gender</FormLabel>
                    <FormControl>
                      <Input placeholder="Gender identity" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="john.doe@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="(555) 123-4567" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea placeholder="123 Main St, City, State 12345" {...field} rows={2} />
                  </FormControl>
                </FormItem>
              )}
            />

            <Separator />
            <h4 className="font-medium text-slate-700">School Information</h4>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="schoolName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>School Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Lincoln Elementary" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="schoolGrade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Grade</FormLabel>
                    <FormControl>
                      <Input placeholder="3rd Grade" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="teacherName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teacher's Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Mrs. Smith" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="schoolConcerns"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>School Concerns</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Any concerns from school or teachers..." {...field} rows={2} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 3: Parent/Guardian 1 */}
        {step === 3 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Parent/Guardian Information</h3>

            <FormField
              control={form.control}
              name="parent1Name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Jane Doe" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="parent1Address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="123 Main Street" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="parent1City"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input placeholder="City" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parent1State"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <FormControl>
                      <Input placeholder="State" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parent1Zip"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Zip Code</FormLabel>
                    <FormControl>
                      <Input placeholder="12345" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="parent1Email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="parent@email.com" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parent1Phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="(555) 123-4567" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="parent1Cell"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cell Phone</FormLabel>
                  <FormControl>
                    <Input placeholder="(555) 987-6543" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex gap-6">
              <FormField
                control={form.control}
                name="parent1EmailReminders"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="text-sm font-normal">Email Appointment Reminders</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parent1TextReminders"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="text-sm font-normal">Text Message Reminders</FormLabel>
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 4: Parent 2 & Emergency Contact */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Parent/Guardian 2 (Optional)</h3>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="parent2Name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parent2Phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="(555) 123-4567" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="parent2Address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input placeholder="If different from Parent 1" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parent2Email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="parent2@email.com" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <Separator />
            <h3 className="text-lg font-semibold text-slate-900">Emergency Contact</h3>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="emergencyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Emergency contact name" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="emergencyPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="(555) 123-4567" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="emergencyRelationship"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Relationship</FormLabel>
                    <FormControl>
                      <Input placeholder="Grandmother, Uncle, etc." {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 5: Reason for Therapy */}
        {step === 5 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Reason for Seeking Therapy</h3>

            <FormField
              control={form.control}
              name="mainConcerns"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What are your main concerns regarding your child?</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Please describe your concerns in detail..."
                      {...field}
                      rows={4}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="therapyGoals"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What do you want to achieve for your child by coming to therapy?</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe your goals and expectations..."
                      {...field}
                      rows={4}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 6: Birth History */}
        {step === 6 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Birth History</h3>

            <FormField
              control={form.control}
              name="pregnancyProblems"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Did you have any problems during pregnancy?</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="no">No</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            {form.watch("pregnancyProblems") === "yes" && (
              <FormField
                control={form.control}
                name="pregnancyDetails"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Please provide details</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Describe any pregnancy complications..." {...field} rows={2} />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="birthType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Was the birth...</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="full_term">Full Term</SelectItem>
                        <SelectItem value="premature">Premature</SelectItem>
                        <SelectItem value="post_term">Post Term</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="birthWeeks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weeks at Birth</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., 38 weeks" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="deliveryType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type of Delivery</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="vaginal">Vaginal</SelectItem>
                        <SelectItem value="c_section">C-Section</SelectItem>
                        <SelectItem value="assisted">Assisted (forceps/vacuum)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="laborLength"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Length of Labor</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., 12 hours" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="birthComplications"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Any birth complications?</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Oxygen required, jaundice, etc." {...field} rows={2} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="nicuStay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>NICU Stay Required?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="no">No</SelectItem>
                        <SelectItem value="yes">Yes</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              {form.watch("nicuStay") === "yes" && (
                <FormField
                  control={form.control}
                  name="nicuDuration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 2 weeks" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 7: Medical History */}
        {step === 7 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Medical History</h3>

            <FormField
              control={form.control}
              name="diagnosis"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Diagnosis/Diagnoses</FormLabel>
                  <FormControl>
                    <Textarea placeholder="List any diagnoses..." {...field} rows={2} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="medications"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Medications</FormLabel>
                  <FormControl>
                    <Textarea placeholder="List medications and dosages..." {...field} rows={2} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sicknessFrequency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>How often does your child get sick?</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="rarely">Rarely</SelectItem>
                      <SelectItem value="sometimes">Sometimes</SelectItem>
                      <SelectItem value="often">Often</SelectItem>
                      <SelectItem value="very_often">Very Often</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="allergies"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Does your child have any allergies?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="no">No</SelectItem>
                        <SelectItem value="yes">Yes</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              {form.watch("allergies") === "yes" && (
                <FormField
                  control={form.control}
                  name="allergyDetails"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Allergy Details</FormLabel>
                      <FormControl>
                        <Input placeholder="List allergies..." {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="hearingTested"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Has hearing been tested?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="no">No</SelectItem>
                        <SelectItem value="yes_normal">Yes - Normal</SelectItem>
                        <SelectItem value="yes_abnormal">Yes - Abnormal</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="visionTested"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Has vision been tested?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="no">No</SelectItem>
                        <SelectItem value="yes_normal">Yes - Normal</SelectItem>
                        <SelectItem value="yes_abnormal">Yes - Abnormal</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="surgeries"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Please list any surgeries or procedures with approximate dates</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Surgery/procedure - Date" {...field} rows={3} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 8: Nutrition & Treatment History */}
        {step === 8 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Nutrition History</h3>

            <FormField
              control={form.control}
              name="nutritionConcerns"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Do you have concerns with any of the following?</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Feeding difficulties, picky eating, texture issues, etc."
                      {...field}
                      rows={2}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <Separator />
            <h3 className="text-lg font-semibold text-slate-900">Treatment History</h3>
            <p className="text-sm text-slate-600">Please list any previous therapy services received</p>

            <FormField
              control={form.control}
              name="previousTherapy"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      placeholder="e.g., Speech Therapy at ABC Clinic - 2023-2024, reason: speech delay
Occupational Therapy at XYZ Center - 2022, reason: fine motor skills"
                      {...field}
                      rows={6}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 9: Social History */}
        {step === 9 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Social History</h3>
            <p className="text-sm text-slate-600">In order for us to best work with you, we need to know a little about your family.</p>

            <FormField
              control={form.control}
              name="custodyArrangements"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Are there any formal custody arrangements in place?</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="no">No</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            {form.watch("custodyArrangements") === "yes" && (
              <FormField
                control={form.control}
                name="custodyDetails"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Please provide details</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Custody arrangement details..." {...field} rows={2} />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="familyDetails"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Please provide details of your family (name, gender, age, half/step siblings)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="List family members..." {...field} rows={3} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="familyMedicalHistory"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Please provide details of any relevant family medical history</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Autism, learning problems, mental health conditions, etc."
                      {...field}
                      rows={2}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="familyImpactHistory"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Please provide details of any family history which might impact on your child</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Divorce, separation, recent moves, significant life changes..."
                      {...field}
                      rows={2}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 10: Developmental History */}
        {step === 10 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Developmental History</h3>
            <p className="text-sm text-slate-600">At what age did your child achieve the following milestones?</p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <FormField control={form.control} name="milestoneHeadUp" render={({ field }) => (
                <FormItem>
                  <FormLabel>Hold head up</FormLabel>
                  <FormControl><Input placeholder="e.g., 3 months" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="milestoneRollOver" render={({ field }) => (
                <FormItem>
                  <FormLabel>Roll over</FormLabel>
                  <FormControl><Input placeholder="e.g., 4 months" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="milestoneSitIndependently" render={({ field }) => (
                <FormItem>
                  <FormLabel>Sit independently</FormLabel>
                  <FormControl><Input placeholder="e.g., 6 months" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="milestoneCreep" render={({ field }) => (
                <FormItem>
                  <FormLabel>Creep</FormLabel>
                  <FormControl><Input placeholder="e.g., 7 months" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="milestoneCrawl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Crawl</FormLabel>
                  <FormControl><Input placeholder="e.g., 8 months" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="milestoneStandAlone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Stand alone</FormLabel>
                  <FormControl><Input placeholder="e.g., 10 months" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="milestoneWalk" render={({ field }) => (
                <FormItem>
                  <FormLabel>Walk independently</FormLabel>
                  <FormControl><Input placeholder="e.g., 12 months" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="milestoneFirstWord" render={({ field }) => (
                <FormItem>
                  <FormLabel>First word</FormLabel>
                  <FormControl><Input placeholder="e.g., 12 months" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="milestoneWave" render={({ field }) => (
                <FormItem>
                  <FormLabel>Wave</FormLabel>
                  <FormControl><Input placeholder="e.g., 9 months" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="milestonePoint" render={({ field }) => (
                <FormItem>
                  <FormLabel>Point</FormLabel>
                  <FormControl><Input placeholder="e.g., 10 months" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="handPreference" render={({ field }) => (
                <FormItem>
                  <FormLabel>Hand preference</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                      <SelectItem value="mixed">Mixed/Not established</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 11: Sensory Processing (Part 1) */}
        {step === 11 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Sensory Processing (Part 1)</h3>
            <p className="text-sm text-slate-600">Please select the response that best describes your child's behavior.</p>

            <div className="space-y-3">
              <SensoryQuestion
                question="Seems to be in constant motion or is unable to sit still for an activity"
                fieldName="sensoryConstantMotion"
                commentsFieldName="sensoryConstantMotionComments"
              />
              <SensoryQuestion
                question="Has trouble concentrating or can't stay on task"
                fieldName="sensoryConcentration"
                commentsFieldName="sensoryConcentrationComments"
              />
              <SensoryQuestion
                question="Seems to always be running, jumping, or stomping rather than walking"
                fieldName="sensoryRunningJumping"
                commentsFieldName="sensoryRunningJumpingComments"
              />
              <SensoryQuestion
                question="Bumps into things or frequently knocks things over"
                fieldName="sensoryBumpsInto"
                commentsFieldName="sensoryBumpsIntoComments"
              />
              <SensoryQuestion
                question="Reacts strongly to being bumped or touched"
                fieldName="sensoryReactsToBumps"
                commentsFieldName="sensoryReactsToBumpsComments"
              />
              <SensoryQuestion
                question="Avoids messy play and doesn't like to get hands dirty"
                fieldName="sensoryMessyPlay"
                commentsFieldName="sensoryMessyPlayComments"
              />
              <SensoryQuestion
                question="Hates having hair washed, brushed or cut"
                fieldName="sensoryHairWashing"
                commentsFieldName="sensoryHairWashingComments"
              />
              <SensoryQuestion
                question="Resists wearing new clothing or is bothered by tags or socks"
                fieldName="sensoryClothing"
                commentsFieldName="sensoryClothingComments"
              />
              <SensoryQuestion
                question="Distressed by loud or sudden sounds such as a siren or vacuum"
                fieldName="sensoryLoudSounds"
                commentsFieldName="sensoryLoudSoundsComments"
              />
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 12: Sensory Processing (Part 2) */}
        {step === 12 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Sensory Processing (Part 2)</h3>
            <p className="text-sm text-slate-600">Please continue selecting the response that best describes your child's behavior.</p>

            <div className="space-y-3">
              <SensoryQuestion
                question="Hesitates to play or climb on playground equipment"
                fieldName="sensoryPlayground"
                commentsFieldName="sensoryPlaygroundComments"
              />
              <SensoryQuestion
                question="Difficulties with balance"
                fieldName="sensoryBalance"
                commentsFieldName="sensoryBalanceComments"
              />
              <SensoryQuestion
                question="Loses place when reading or copying from board"
                fieldName="sensoryReading"
                commentsFieldName="sensoryReadingComments"
              />
              <SensoryQuestion
                question="Difficulties tracking objects with eyes"
                fieldName="sensoryTracking"
                commentsFieldName="sensoryTrackingComments"
              />
              <SensoryQuestion
                question="Mood variations, outbursts and tantrums"
                fieldName="sensoryMoodVariations"
                commentsFieldName="sensoryMoodVariationsComments"
              />
              <SensoryQuestion
                question="Avoids eye contact"
                fieldName="sensoryEyeContact"
                commentsFieldName="sensoryEyeContactComments"
              />
              <SensoryQuestion
                question="Has trouble following multistep instructions"
                fieldName="sensoryInstructions"
                commentsFieldName="sensoryInstructionsComments"
              />
              <SensoryQuestion
                question="Fussy eater, often gags on food"
                fieldName="sensoryFussyEater"
                commentsFieldName="sensoryFussyEaterComments"
              />
              <SensoryQuestion
                question="Reacts strongly to smells"
                fieldName="sensorySmells"
                commentsFieldName="sensorySmellsComments"
              />
              <SensoryQuestion
                question="High pain threshold"
                fieldName="sensoryPainThreshold"
                commentsFieldName="sensoryPainThresholdComments"
              />
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 13: Waiver & Release */}
        {step === 13 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <FileSignature className="w-6 h-6 text-amber-600" />
              <h3 className="text-lg font-semibold text-slate-900">Waiver and Release of Liability</h3>
            </div>

            <ScrollArea className="h-[350px] border rounded-lg p-4 bg-slate-50">
              <div className="space-y-4 text-sm text-slate-700 pr-4">
                <p><strong>IN CONSIDERATION OF</strong> the risk of injury that exists while participating in OCCUPATIONAL THERAPY (hereinafter the "Activity"); and</p>

                <p><strong>IN CONSIDERATION OF</strong> my desire to participate in said Activity and being given the right to participate in same;</p>

                <p>I HEREBY, for myself, my heirs, executors, administrators, assigns, or personal representatives (hereinafter collectively, "Releasor," "I" or "me", which terms shall also include Releasor's parents or guardian if Releasor is under 18 years of age), knowingly and voluntarily enter into this WAIVER AND RELEASE OF LIABILITY and hereby waive any and all rights, claims or causes of action of any kind arising out of my participation in the Activity; and</p>

                <p>I HEREBY release and forever discharge <strong>WONDER KIDS THERAPY CENTER</strong>, located at 70 Van Valkenburgh Ave, Bergenfield, New Jersey 07621, their affiliates, managers, members, agents, attorneys, staff, volunteers, heirs, representatives, predecessors, successors and assigns (collectively "Releasees"), from any physical or psychological injury that I may suffer as a direct result of my participation in the aforementioned Activity.</p>

                <p className="font-semibold uppercase">I AM VOLUNTARILY PARTICIPATING IN THE AFOREMENTIONED ACTIVITY AND I AM PARTICIPATING IN THE ACTIVITY ENTIRELY AT MY OWN RISK.</p>

                <p>I AM AWARE OF THE RISKS ASSOCIATED WITH PARTICIPATING IN THIS ACTIVITY, WHICH MAY INCLUDE, BUT ARE NOT LIMITED TO: PHYSICAL OR PSYCHOLOGICAL INJURY, PAIN, SUFFERING, ILLNESS, DISFIGUREMENT, TEMPORARY OR PERMANENT DISABILITY (INCLUDING PARALYSIS), ECONOMIC OR EMOTIONAL LOSS, AND DEATH.</p>

                <p>I UNDERSTAND THAT THESE INJURIES OR OUTCOMES MAY ARISE FROM MY OWN OR OTHERS' NEGLIGENCE, CONDITIONS RELATED TO TRAVEL TO AND FROM THE ACTIVITY, OR FROM CONDITIONS AT THE ACTIVITY LOCATIONS.</p>

                <p><strong>NONETHELESS, I ASSUME ALL RELATED RISKS, BOTH KNOWN AND UNKNOWN TO ME, OF MY PARTICIPATION IN THIS ACTIVITY.</strong></p>

                <p>I FURTHER AGREE to indemnify, defend and hold harmless the Releasees against any and all claims, suits or actions of any kind whatsoever for liability, damages, compensation or otherwise brought by me or anyone on my behalf, including attorney's fees and any related costs.</p>

                <p>I FURTHER ACKNOWLEDGE that Releasees are not responsible for errors, omissions, acts or failures to act of any party or entity conducting a specific event or activity on behalf of Releasees.</p>

                <p>In the event that I should require medical care or treatment, I authorize Wonder Kids Therapy Center to provide all emergency medical care deemed necessary, including but not limited to, first aid, CPR, the use of AEDs, emergency medical transport, and sharing of medical information with medical personnel.</p>
              </div>
            </ScrollArea>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <FormField
                  control={form.control}
                  name="waiverConsent"
                  render={({ field }) => (
                    <FormItem className="flex items-start space-x-3">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          I certify that I am the parent or guardian of the patient named above, and I give my consent without reservation to the foregoing on behalf of this individual.
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="waiverSignature"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Signature (Type Full Name)</FormLabel>
                      <FormControl>
                        <Input placeholder="John Doe" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="waiverDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} defaultValue={new Date().toISOString().split('T')[0]} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button
                type="button"
                onClick={nextStep}
                disabled={!form.watch("waiverConsent") || !form.watch("waiverSignature")}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step 14: Financial Responsibility */}
        {step === 14 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard className="w-6 h-6 text-green-600" />
              <h3 className="text-lg font-semibold text-slate-900">Patient Financial Responsibility</h3>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Insurance Authorization for Assignment of Benefits</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-700">
                <p>I hereby authorize and direct payment of my medical benefits to Wonder Kids Therapy Center on my behalf for any services rendered to me by the providers within the practice.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Authorization to Release Records</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-700">
                <p>I hereby authorize Wonder Kids Therapy Center to release to my insurer, governmental agencies, or any other entity financially responsible for my medical care, all information, including diagnosis and records of any treatment or examination rendered to me needed to substantiate payment for such medical services as well as information required for precertification, authorization or referral to other medical providers.</p>
              </CardContent>
            </Card>

            <Separator />

            <h4 className="font-medium text-slate-700">Insurance Information</h4>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="insuranceProvider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Insurance Provider</FormLabel>
                    <FormControl>
                      <Input placeholder="Blue Cross Blue Shield" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="insuranceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Member ID</FormLabel>
                    <FormControl>
                      <Input placeholder="ABC123456789" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="policyNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Policy Number</FormLabel>
                    <FormControl>
                      <Input placeholder="POL123456" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="groupNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group Number</FormLabel>
                    <FormControl>
                      <Input placeholder="GRP789" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <FormField
                  control={form.control}
                  name="financialConsent"
                  render={({ field }) => (
                    <FormItem className="flex items-start space-x-3">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          I agree to the financial responsibility terms and authorize Wonder Kids Therapy Center to bill my insurance and release necessary records.
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="financialSignature"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parent/Guardian Signature (Type Full Name)</FormLabel>
                      <FormControl>
                        <Input placeholder="John Doe" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="financialDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} defaultValue={new Date().toISOString().split('T')[0]} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button
                type="button"
                onClick={nextStep}
                disabled={!form.watch("financialConsent") || !form.watch("financialSignature")}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step 15: Insurance Documents */}
        {step === 15 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Insurance Plan Document (Optional)</h3>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-600 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Why upload your plan document?</p>
                  <p>Uploading your Summary of Benefits and Coverage (SBC) or plan document helps us understand your exact out-of-network benefits, so we can give you accurate cost estimates before your appointments.</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-medium">Document Type</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select document type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sbc">Summary of Benefits (SBC)</SelectItem>
                  <SelectItem value="eob">Explanation of Benefits (EOB)</SelectItem>
                  <SelectItem value="plan_contract">Plan Contract / SPD</SelectItem>
                  <SelectItem value="insurance_card">Insurance Card</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-medium">Upload Document</Label>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  planDocument
                    ? "border-green-300 bg-green-50"
                    : "border-slate-300 hover:border-medical-blue-400 hover:bg-slate-50"
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {planDocument ? (
                  <div className="flex items-center justify-center gap-2 text-green-700">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-medium">{planDocument.name}</span>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm text-slate-600">Click to upload or drag and drop</p>
                    <p className="text-xs text-slate-500 mt-1">PDF or image files up to 10MB</p>
                  </>
                )}
              </div>
              {planDocument && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPlanDocument(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  Remove file
                </Button>
              )}
            </div>

            {planDocument && (
              <div className="flex items-start space-x-2 p-3 bg-slate-50 rounded-lg">
                <Checkbox
                  id="consent"
                  checked={consentGiven}
                  onCheckedChange={(checked) => setConsentGiven(checked === true)}
                />
                <Label htmlFor="consent" className="text-sm text-slate-700 leading-tight">
                  I consent to having my insurance plan document analyzed to extract benefit information for cost estimation purposes. This information will be kept confidential and used only by this practice.
                </Label>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button type="button" variant="outline" onClick={prevStep}>Previous</Button>
              <Button
                type="submit"
                disabled={createPatientMutation.isPending || uploadingDocument || !!(planDocument && !consentGiven)}
                className="bg-medical-blue-500 hover:bg-medical-blue-600"
              >
                {uploadingDocument ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing Document...
                  </>
                ) : createPatientMutation.isPending ? (
                  "Submitting..."
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Complete Registration
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Form>
  );
}
