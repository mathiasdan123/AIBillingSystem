import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { insertPatientSchema } from "@shared/schema";
import { getAuthHeaders } from "@/hooks/useAuth";
import {
  User,
  FileText,
  Mic,
  Upload,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Shield,
  Zap,
  Brain,
  Stethoscope,
  AlertCircle,
  Building2,
  FileCheck,
} from "lucide-react";

// Simplified patient schema for intake
const patientIntakeSchema = z.object({
  // Required fields that match the patient table
  practiceId: z.number().default(1), // Will be set dynamically
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  email: z.string().email("Valid email is required").optional().or(z.literal("")),
  phone: z.string().min(1, "Phone number is required"),
  address: z.string().min(1, "Address is required"),
  
  // Insurance information
  insuranceProvider: z.string().min(1, "Insurance provider is required"),
  insuranceId: z.string().min(1, "Insurance ID is required"),
  policyNumber: z.string().min(1, "Policy number is required"),
  groupNumber: z.string().optional().or(z.literal("")),
  
  // Additional intake fields (will be stored in notes or processed separately)
  emergencyContactName: z.string().min(1, "Emergency contact name is required"),
  emergencyContactPhone: z.string().min(1, "Emergency contact phone is required"),
  emergencyContactRelation: z.string().min(1, "Relationship is required"),
  
  // Medical history
  primaryDiagnosis: z.string().optional().or(z.literal("")),
  medicalHistory: z.string().optional().or(z.literal("")),
  currentMedications: z.string().optional().or(z.literal("")),
  allergies: z.string().optional().or(z.literal("")),
  
  // Referral information
  referringPhysician: z.string().optional().or(z.literal("")),
  referralDate: z.string().optional().or(z.literal("")),
  
  // Data capture method
  dataSource: z.enum(["manual", "voice", "upload"]).default("manual"),
  
  // Payment information
  cardNumber: z.string().min(1, "Card number is required"),
  expiryDate: z.string().min(1, "Expiry date is required"),
  cvv: z.string().min(3, "CVV is required").max(4),
  cardholderName: z.string().min(1, "Cardholder name is required"),
  billingAddress: z.string().min(1, "Billing address is required"),
  billingZip: z.string().min(1, "Billing ZIP code is required"),
  
  // HIPAA Insurance Consents
  insuranceConsentAuthorized: z.boolean().default(false),
  assignmentOfBenefitsConsent: z.boolean().default(false),
  releaseOfInfoConsent: z.boolean().default(false),
  consentSignerRelationship: z.string().default("self"), // self, parent, guardian, legal_representative
  consentSignerName: z.string().optional(),

  // Signature and agreement
  electronicSignature: z.string().min(1, "Electronic signature is required"),
  agreesToTerms: z.boolean().refine(val => val === true, "You must agree to the terms and conditions"),
  agreesToPrivacy: z.boolean().refine(val => val === true, "You must agree to the privacy policy"),
  dateOfSignature: z.string().default(() => new Date().toISOString().split('T')[0]),
  
  voiceTranscriptionUrl: z.string().optional(),
  uploadedDocumentUrl: z.string().optional(),
});

type PatientIntakeForm = z.infer<typeof patientIntakeSchema>;

const INTAKE_STEPS = [
  { id: 0, title: "Data Input Method", description: "Choose how to input patient information" },
  { id: 1, title: "Basic Information", description: "Patient's personal information" },
  { id: 2, title: "Clinical Information", description: "Known diagnosis and referral details" },
  { id: 3, title: "Insurance Details", description: "Insurance provider and coverage information" },
  { id: 4, title: "Payment Information", description: "Credit card and billing details" },
  { id: 5, title: "Medical History", description: "Current medications, allergies, and medical history" },
  { id: 6, title: "Emergency Contact", description: "Emergency contact information" },
  { id: 7, title: "Electronic Signature", description: "Review terms and provide electronic signature" },
  { id: 8, title: "Review & Submit", description: "Review all information and submit" },
];

export default function PatientIntake() {
  const [currentStep, setCurrentStep] = useState(0);
  const [inputMethod, setInputMethod] = useState<"manual" | "voice" | "upload">("manual");
  const [isRecording, setIsRecording] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch practice info for consent forms
  const { data: practiceInfo } = useQuery<{
    id: number;
    name: string;
    address: string;
    phone: string;
    email: string;
    npi: string;
    brandLogoUrl: string;
    brandPrimaryColor: string;
    brandPrivacyPolicyUrl: string;
  }>({
    queryKey: ['/api/practices/1/public-info'],
  });

  // Load saved form data from localStorage
  const getSavedFormData = () => {
    try {
      const saved = localStorage.getItem('patientIntakeForm');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Error loading saved form data:', e);
    }
    return null;
  };

  const savedData = getSavedFormData();

  const form = useForm<PatientIntakeForm>({
    resolver: zodResolver(patientIntakeSchema),
    defaultValues: savedData || {
      practiceId: 1, // TODO: Get from user's practice
      firstName: "",
      lastName: "",
      dateOfBirth: "",
      email: "",
      phone: "",
      address: "",
      insuranceProvider: "",
      insuranceId: "",
      policyNumber: "",
      groupNumber: "",

      emergencyContactName: "",
      emergencyContactPhone: "",
      emergencyContactRelation: "",
      primaryDiagnosis: "",
      medicalHistory: "",
      currentMedications: "",
      allergies: "",
      referringPhysician: "",
      referralDate: "",
      dataSource: "manual",
      cardNumber: "",
      expiryDate: "",
      cvv: "",
      cardholderName: "",
      billingAddress: "",
      billingZip: "",
      insuranceConsentAuthorized: false,
      assignmentOfBenefitsConsent: false,
      releaseOfInfoConsent: false,
      consentSignerRelationship: "self",
      consentSignerName: "",
      electronicSignature: "",
      agreesToTerms: false,
      agreesToPrivacy: false,
      dateOfSignature: new Date().toISOString().split('T')[0],
    },
  });

  // Auto-save form data to localStorage
  useEffect(() => {
    const subscription = form.watch((data) => {
      try {
        localStorage.setItem('patientIntakeForm', JSON.stringify(data));
      } catch (e) {
        console.error('Error saving form data:', e);
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // Also save current step
  useEffect(() => {
    localStorage.setItem('patientIntakeStep', String(currentStep));
  }, [currentStep]);

  // Load saved step on mount
  useEffect(() => {
    const savedStep = localStorage.getItem('patientIntakeStep');
    if (savedStep) {
      setCurrentStep(parseInt(savedStep, 10));
    }
  }, []);

  const createPatientMutation = useMutation({
    mutationFn: async (data: PatientIntakeForm) => {
      // Transform the intake form data to match the patient schema
      const { emergencyContactName, emergencyContactPhone, emergencyContactRelation, 
              primaryDiagnosis, medicalHistory, currentMedications, allergies, 
              referringPhysician, referralDate, ...patientData } = data;
      
      // Store additional intake information in a structured format
      const intakeNotes = {
        emergencyContact: {
          name: emergencyContactName,
          phone: emergencyContactPhone,
          relation: emergencyContactRelation
        },
        medicalInfo: {
          primaryDiagnosis,
          medicalHistory,
          currentMedications,
          allergies,
          referringPhysician,
          referralDate
        }
      };
      
      // Add structured intake notes to the patient data
      const finalPatientData = {
        ...patientData,
        // Store intake information as JSON in a notes field or similar
        intakeNotes: JSON.stringify(intakeNotes)
      };
      
      const response = await apiRequest("POST", "/api/patients", finalPatientData);
      const patient = await response.json();

      // Create HIPAA-compliant consent records
      const practiceId = data.practiceId || 1;
      const signerName = data.consentSignerRelationship === 'self'
        ? `${data.firstName} ${data.lastName}`
        : data.consentSignerName || `${data.firstName} ${data.lastName}`;

      // Insurance Verification Consent
      if (data.insuranceConsentAuthorized && patient.id) {
        try {
          await fetch('/api/patient-consents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              practiceId,
              patientId: patient.id,
              consentType: 'insurance_verification',
              purposeOfDisclosure: 'To verify insurance eligibility, coverage details, and benefits for therapy services',
              informationToBeDisclosed: 'Patient name, date of birth, insurance member ID, policy number, and group number',
              recipientOfInformation: `${data.insuranceProvider} and affiliated clearinghouses`,
              signatureType: 'electronic',
              signatureName: signerName,
              signerRelationship: data.consentSignerRelationship,
              signerName: data.consentSignerRelationship !== 'self' ? signerName : null,
            }),
          });

          // Auto-check eligibility via Stedi when consent is granted
          try {
            const eligibilityResponse = await fetch('/api/insurance/eligibility', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                patientId: patient.id,
              }),
            });
            const eligibilityData = await eligibilityResponse.json();
            if (eligibilityData.success && eligibilityData.eligibility?.status === 'active') {
              console.log('Eligibility verified:', eligibilityData.eligibility);
            }
          } catch (eligibilityErr) {
            console.error('Auto eligibility check failed:', eligibilityErr);
          }
        } catch (err) {
          console.error('Insurance verification consent/trigger failed:', err);
        }
      }

      // Assignment of Benefits Consent
      if (data.assignmentOfBenefitsConsent && patient.id) {
        try {
          await fetch('/api/patient-consents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              practiceId,
              patientId: patient.id,
              consentType: 'assignment_of_benefits',
              purposeOfDisclosure: 'To authorize direct payment of insurance benefits to the healthcare provider',
              informationToBeDisclosed: 'Treatment dates, procedure codes, diagnosis codes, and billed amounts',
              recipientOfInformation: `${data.insuranceProvider}`,
              signatureType: 'electronic',
              signatureName: signerName,
              signerRelationship: data.consentSignerRelationship,
              signerName: data.consentSignerRelationship !== 'self' ? signerName : null,
            }),
          });
        } catch (err) {
          console.error('Assignment of benefits consent failed:', err);
        }
      }

      // Release of Information Consent
      if (data.releaseOfInfoConsent && patient.id) {
        try {
          await fetch('/api/patient-consents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              practiceId,
              patientId: patient.id,
              consentType: 'hipaa_release',
              purposeOfDisclosure: 'To submit claims and communicate with insurance company regarding coverage and payment',
              informationToBeDisclosed: 'Protected health information necessary for claims processing including diagnosis, treatment notes, and clinical documentation',
              recipientOfInformation: `${data.insuranceProvider}, affiliated clearinghouses, and billing entities`,
              signatureType: 'electronic',
              signatureName: signerName,
              signerRelationship: data.consentSignerRelationship,
              signerName: data.consentSignerRelationship !== 'self' ? signerName : null,
            }),
          });
        } catch (err) {
          console.error('Release of info consent failed:', err);
        }
      }

      return patient;
    },
    onSuccess: () => {
      // Clear saved form data
      localStorage.removeItem('patientIntakeForm');
      localStorage.removeItem('patientIntakeStep');

      toast({
        title: "Patient Added Successfully",
        description: "Patient information has been saved and is ready for billing.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      navigate("/patients");
    },
    onError: (error) => {
      toast({
        title: "Error Adding Patient",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleVoiceRecording = async () => {
    if (!isRecording) {
      setIsRecording(true);
      // Simulate voice recording - in real implementation, would use Web Speech API
      setTimeout(() => {
        setIsRecording(false);
        toast({
          title: "Voice Recording Complete",
          description: "AI is processing your dictation...",
        });
        // Simulate AI processing
        setTimeout(() => {
          // Auto-populate form with extracted data
          form.setValue("firstName", "John");
          form.setValue("lastName", "Smith");
          form.setValue("dateOfBirth", "1975-03-15");
          form.setValue("phone", "(555) 123-4567");
          form.setValue("insuranceProvider", "Blue Cross Blue Shield");
          form.setValue("dataSource", "voice");
          toast({
            title: "AI Processing Complete",
            description: "Patient information extracted from voice recording. Please review and complete missing fields.",
          });
          setCurrentStep(1); // Move to basic info step
        }, 2000);
      }, 3000);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      toast({
        title: "Document Uploaded",
        description: "AI is extracting patient information...",
      });
      
      // Simulate AI document processing
      setTimeout(() => {
        // Auto-populate form with extracted data
        form.setValue("firstName", "Sarah");
        form.setValue("lastName", "Johnson");
        form.setValue("dateOfBirth", "1982-07-22");
        form.setValue("phone", "(555) 987-6543");
        form.setValue("insuranceProvider", "Aetna");
        form.setValue("primaryDiagnosis", "Carpal Tunnel Syndrome");
        form.setValue("dataSource", "upload");
        toast({
          title: "AI Processing Complete",
          description: "Patient information extracted from document. Please review and complete missing fields.",
        });
        setCurrentStep(1); // Move to basic info step
      }, 2000);
    }
  };

  const nextStep = () => {
    if (currentStep < INTAKE_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const onSubmit = (data: PatientIntakeForm) => {
    createPatientMutation.mutate(data);
  };

  const progress = ((currentStep + 1) / INTAKE_STEPS.length) * 100;

  return (
    <div className="md:ml-64 min-h-screen bg-slate-50 py-8 pt-20 md:pt-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Patient Intake</h1>
          <p className="text-lg text-slate-600">
            Add new patient information using our AI-powered data capture
          </p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm font-medium text-slate-700">
              Step {currentStep + 1} of {INTAKE_STEPS.length}
            </span>
            <span className="text-sm text-slate-500">
              {Math.round(progress)}% Complete
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            {/* Step 0: Data Input Method Selection */}
            {currentStep === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-blue-500" />
                    {INTAKE_STEPS[0].title}
                  </CardTitle>
                  <CardDescription>{INTAKE_STEPS[0].description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    
                    {/* Voice Input */}
                    <Card className={`cursor-pointer transition-all ${inputMethod === "voice" ? "ring-2 ring-blue-500 bg-blue-50" : "hover:shadow-md"}`}>
                      <CardContent className="p-6 text-center">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Mic className={`w-8 h-8 ${isRecording ? "text-red-500 animate-pulse" : "text-blue-500"}`} />
                        </div>
                        <h3 className="font-semibold mb-2">Voice Dictation</h3>
                        <p className="text-sm text-slate-600 mb-4">
                          Speak patient information naturally and our AI will extract all necessary details
                        </p>
                        <Button
                          type="button"
                          variant={inputMethod === "voice" ? "default" : "outline"}
                          className="w-full"
                          onClick={handleVoiceRecording}
                          disabled={isRecording}
                          data-testid="button-voice-recording"
                        >
                          {isRecording ? "Recording..." : "Start Recording"}
                        </Button>
                        <div className="flex items-center justify-center gap-1 mt-2">
                          <Shield className="w-3 h-3 text-green-500" />
                          <span className="text-xs text-green-600">HIPAA Secure</span>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Document Upload */}
                    <Card className={`cursor-pointer transition-all ${inputMethod === "upload" ? "ring-2 ring-green-500 bg-green-50" : "hover:shadow-md"}`}>
                      <CardContent className="p-6 text-center">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Upload className="w-8 h-8 text-green-500" />
                        </div>
                        <h3 className="font-semibold mb-2">Document Upload</h3>
                        <p className="text-sm text-slate-600 mb-4">
                          Upload referral letters, intake forms, or medical records
                        </p>
                        <div className="relative">
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.txt,.jpg,.png"
                            onChange={handleFileUpload}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            data-testid="input-file-upload"
                          />
                          <Button
                            type="button"
                            variant={inputMethod === "upload" ? "default" : "outline"}
                            className="w-full"
                          >
                            {uploadedFile ? "Change File" : "Choose File"}
                          </Button>
                        </div>
                        {uploadedFile && (
                          <p className="text-xs text-green-600 mt-2">{uploadedFile.name}</p>
                        )}
                        <div className="flex items-center justify-center gap-1 mt-2">
                          <Brain className="w-3 h-3 text-blue-500" />
                          <span className="text-xs text-blue-600">AI Powered</span>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Manual Entry */}
                    <Card className={`cursor-pointer transition-all ${inputMethod === "manual" ? "ring-2 ring-slate-500 bg-slate-50" : "hover:shadow-md"}`}>
                      <CardContent className="p-6 text-center">
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <FileText className="w-8 h-8 text-slate-500" />
                        </div>
                        <h3 className="font-semibold mb-2">Manual Entry</h3>
                        <p className="text-sm text-slate-600 mb-4">
                          Fill out patient information using traditional forms
                        </p>
                        <Button
                          type="button"
                          variant={inputMethod === "manual" ? "default" : "outline"}
                          className="w-full"
                          onClick={() => {
                            setInputMethod("manual");
                            form.setValue("dataSource", "manual");
                            nextStep();
                          }}
                          data-testid="button-manual-entry"
                        >
                          Start Manual Entry
                        </Button>
                        <div className="flex items-center justify-center gap-1 mt-2">
                          <CheckCircle className="w-3 h-3 text-slate-500" />
                          <span className="text-xs text-slate-600">Traditional</span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {inputMethod !== "manual" && (
                    <div className="text-center">
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                        AI will auto-populate forms - you can review and edit before submitting
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Step 2: Diagnosis & Referral */}
            {currentStep === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Stethoscope className="w-5 h-5 text-green-500" />
                    {INTAKE_STEPS[2].title}
                  </CardTitle>
                  <CardDescription>{INTAKE_STEPS[2].description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="primaryDiagnosis" 
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Primary Diagnosis</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="e.g., Carpal Tunnel Syndrome, Stroke Recovery, etc." 
                            {...field} 
                            data-testid="input-primary-diagnosis" 
                          />
                        </FormControl>
                        <FormDescription>
                          If known - this will be documented during the first visit evaluation
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="referringPhysician"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Referring Physician</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Dr. Smith" 
                              {...field} 
                              data-testid="input-referring-physician" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="referralDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Referral Date</FormLabel>
                          <FormControl>
                            <Input 
                              type="date" 
                              {...field} 
                              data-testid="input-referral-date" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 1: Basic Information */}
            {currentStep === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5 text-blue-500" />
                    {INTAKE_STEPS[1].title}
                  </CardTitle>
                  <CardDescription>{INTAKE_STEPS[1].description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="John" {...field} data-testid="input-first-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="Smith" {...field} data-testid="input-last-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="dateOfBirth"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date of Birth *</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} data-testid="input-date-of-birth" />
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
                          <FormLabel>Phone Number *</FormLabel>
                          <FormControl>
                            <Input placeholder="(555) 123-4567" {...field} data-testid="input-phone" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input placeholder="john.smith@email.com" type="email" {...field} data-testid="input-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address *</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="123 Main St, City, State, ZIP" 
                            rows={3} 
                            {...field} 
                            data-testid="input-address"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 3: Insurance Details */}
            {currentStep === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-green-500" />
                    {INTAKE_STEPS[3].title}
                  </CardTitle>
                  <CardDescription>{INTAKE_STEPS[3].description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="insuranceProvider"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Insurance Provider *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} data-testid="select-insurance-provider">
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select insurance provider" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="aetna">Aetna</SelectItem>
                            <SelectItem value="anthem">Anthem</SelectItem>
                            <SelectItem value="bcbs">Blue Cross Blue Shield</SelectItem>
                            <SelectItem value="cigna">Cigna</SelectItem>
                            <SelectItem value="humana">Humana</SelectItem>
                            <SelectItem value="medicare">Medicare</SelectItem>
                            <SelectItem value="medicaid">Medicaid</SelectItem>
                            <SelectItem value="unitedhealth">UnitedHealth</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="insuranceId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Insurance ID/Member ID *</FormLabel>
                          <FormControl>
                            <Input placeholder="123456789" {...field} data-testid="input-insurance-id" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="policyNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Policy Number *</FormLabel>
                          <FormControl>
                            <Input placeholder="POL123456" {...field} data-testid="input-policy-number" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="groupNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Group Number</FormLabel>
                        <FormControl>
                          <Input placeholder="GRP789123" {...field} data-testid="input-group-number" />
                        </FormControl>
                        <FormDescription>
                          Optional - only if provided by insurance company
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* HIPAA-Compliant Insurance Authorization Section */}
                  <div className="border-t pt-6 mt-6">
                    <div className="flex items-center gap-2 mb-4">
                      <FileCheck className="w-5 h-5 text-blue-600" />
                      <h3 className="font-semibold text-slate-900">Insurance Authorization & Consent</h3>
                    </div>

                    {/* Practice Info Header */}
                    <div className="bg-slate-50 border rounded-lg p-4 mb-4">
                      <div className="flex items-start gap-3">
                        <Building2 className="w-5 h-5 text-slate-600 mt-0.5" />
                        <div>
                          <h4 className="font-medium text-slate-900">
                            {practiceInfo?.name || "Healthcare Provider"}
                          </h4>
                          {practiceInfo?.address && (
                            <p className="text-sm text-slate-600">{practiceInfo.address}</p>
                          )}
                          {practiceInfo?.phone && (
                            <p className="text-sm text-slate-600">Phone: {practiceInfo.phone}</p>
                          )}
                          {practiceInfo?.npi && (
                            <p className="text-sm text-slate-500">NPI: {practiceInfo.npi}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Who is signing (for minors) */}
                    <div className="mb-4">
                      <FormField
                        control={form.control}
                        name="consentSignerRelationship"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Person Signing This Consent</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select relationship" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="self">Patient (Self)</SelectItem>
                                <SelectItem value="parent">Parent/Guardian of Minor</SelectItem>
                                <SelectItem value="guardian">Legal Guardian</SelectItem>
                                <SelectItem value="legal_representative">Legal Representative</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {form.watch("consentSignerRelationship") !== "self" && (
                      <div className="mb-4">
                        <FormField
                          control={form.control}
                          name="consentSignerName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Name of Person Signing *</FormLabel>
                              <FormControl>
                                <Input placeholder="Full legal name" {...field} />
                              </FormControl>
                              <FormDescription>
                                Enter your full legal name if signing on behalf of the patient
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}

                    {/* Consent 1: Insurance Verification */}
                    <div className="border rounded-lg p-4 mb-3 bg-white">
                      <FormField
                        control={form.control}
                        name="insuranceConsentAuthorized"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                checked={field.value}
                                onChange={field.onChange}
                                className="mt-1 h-4 w-4"
                                data-testid="checkbox-insurance-consent"
                              />
                            </FormControl>
                            <div className="space-y-2">
                              <FormLabel className="text-sm font-medium">
                                Authorization to Verify Insurance Benefits
                              </FormLabel>
                              <div className="text-xs text-slate-600 space-y-1">
                                <p><strong>Purpose:</strong> To verify insurance eligibility, coverage details, deductibles, copays, and session limits.</p>
                                <p><strong>Information disclosed:</strong> Patient name, date of birth, insurance member ID, policy number, and group number.</p>
                                <p><strong>Disclosed to:</strong> {form.watch("insuranceProvider") || "Your insurance provider"} and affiliated clearinghouses.</p>
                              </div>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Consent 2: Assignment of Benefits */}
                    <div className="border rounded-lg p-4 mb-3 bg-white">
                      <FormField
                        control={form.control}
                        name="assignmentOfBenefitsConsent"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                checked={field.value}
                                onChange={field.onChange}
                                className="mt-1 h-4 w-4"
                              />
                            </FormControl>
                            <div className="space-y-2">
                              <FormLabel className="text-sm font-medium">
                                Assignment of Insurance Benefits
                              </FormLabel>
                              <div className="text-xs text-slate-600 space-y-1">
                                <p><strong>Purpose:</strong> To authorize direct payment of insurance benefits to {practiceInfo?.name || "the healthcare provider"}.</p>
                                <p><strong>Information disclosed:</strong> Treatment dates, procedure codes (CPT), diagnosis codes (ICD-10), and billed amounts.</p>
                                <p><strong>Disclosed to:</strong> {form.watch("insuranceProvider") || "Your insurance provider"}.</p>
                                <p className="text-slate-500 italic">I understand that I am financially responsible for any amount not covered by my insurance.</p>
                              </div>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Consent 3: Release of Information */}
                    <div className="border rounded-lg p-4 mb-3 bg-white">
                      <FormField
                        control={form.control}
                        name="releaseOfInfoConsent"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                checked={field.value}
                                onChange={field.onChange}
                                className="mt-1 h-4 w-4"
                              />
                            </FormControl>
                            <div className="space-y-2">
                              <FormLabel className="text-sm font-medium">
                                Authorization to Release Protected Health Information
                              </FormLabel>
                              <div className="text-xs text-slate-600 space-y-1">
                                <p><strong>Purpose:</strong> To submit claims and communicate with insurance regarding coverage, payment, and healthcare operations.</p>
                                <p><strong>Information disclosed:</strong> Protected health information necessary for claims processing, including diagnosis codes, treatment notes, and clinical documentation as required.</p>
                                <p><strong>Disclosed to:</strong> {form.watch("insuranceProvider") || "Your insurance provider"}, affiliated clearinghouses, and billing entities.</p>
                              </div>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* HIPAA Notice */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                      <div className="flex items-start gap-3">
                        <Shield className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div className="text-xs text-blue-800">
                          <p className="font-medium mb-1">Your HIPAA Rights</p>
                          <ul className="list-disc list-inside space-y-1">
                            <li>You may revoke these authorizations at any time by submitting a written request.</li>
                            <li>Revocation will not affect any actions taken before the revocation was received.</li>
                            <li>These authorizations will remain in effect until revoked or treatment ends.</li>
                            <li>You have the right to receive a copy of this authorization.</li>
                          </ul>
                          {practiceInfo?.brandPrivacyPolicyUrl && (
                            <p className="mt-2">
                              <a href={practiceInfo.brandPrivacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                                View our full Privacy Policy
                              </a>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                </CardContent>
              </Card>
            )}

            {/* Step 4: Payment Information */}
            {currentStep === 4 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-blue-500" />
                    {INTAKE_STEPS[4].title}
                  </CardTitle>
                  <CardDescription>{INTAKE_STEPS[4].description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <Shield className="w-5 h-5 text-amber-600 mt-0.5" />
                        <div>
                          <h4 className="font-medium text-amber-800 mb-1">Financial Responsibility Notice</h4>
                          <p className="text-sm text-amber-700">
                            You are responsible for any costs not covered by your insurance, including deductibles, 
                            co-payments, and services not covered by your plan. Payment is due at the time of service.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                        <div>
                          <h4 className="font-medium text-blue-800 mb-1">Appointment Policy</h4>
                          <p className="text-sm text-blue-700">
                            While your first visit can be scheduled, it will not take place until all intake forms are completed and submitted. 
                            This ensures we have all necessary information to provide you with the best possible care.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="cardholderName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cardholder Name *</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="John Doe" 
                            {...field} 
                            data-testid="input-cardholder-name" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="cardNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Credit Card Number *</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="1234 5678 9012 3456" 
                            {...field} 
                            data-testid="input-card-number"
                            maxLength={19}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="expiryDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Expiry Date *</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="MM/YY" 
                              {...field} 
                              data-testid="input-expiry-date"
                              maxLength={5}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="cvv"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>CVV *</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="123" 
                              {...field} 
                              data-testid="input-cvv"
                              maxLength={4}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="billingAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Billing Address *</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="123 Main St, City, State" 
                            rows={2}
                            {...field} 
                            data-testid="input-billing-address"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="billingZip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ZIP Code *</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="12345" 
                            {...field} 
                            data-testid="input-billing-zip"
                            maxLength={10}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 5: Medical History */}
            {currentStep === 5 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-purple-500" />
                    {INTAKE_STEPS[5].title}
                  </CardTitle>
                  <CardDescription>{INTAKE_STEPS[5].description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="currentMedications"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Current Medications</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="List current medications..."
                              rows={3}
                              {...field}
                              data-testid="input-current-medications"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="allergies"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Allergies</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Known allergies or adverse reactions..."
                              rows={3}
                              {...field}
                              data-testid="input-allergies"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="medicalHistory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Medical History</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Previous surgeries, chronic conditions, relevant medical history..."
                            rows={3}
                            {...field}
                            data-testid="input-medical-history"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 6: Emergency Contact */}
            {currentStep === 6 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5 text-red-500" />
                    {INTAKE_STEPS[6].title}
                  </CardTitle>
                  <CardDescription>{INTAKE_STEPS[6].description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="emergencyContactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Contact Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="Jane Smith" {...field} data-testid="input-emergency-contact-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="emergencyContactPhone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Emergency Contact Phone *</FormLabel>
                          <FormControl>
                            <Input placeholder="(555) 987-6543" {...field} data-testid="input-emergency-contact-phone" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="emergencyContactRelation"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Relationship *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value} data-testid="select-emergency-contact-relation">
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select relationship" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="spouse">Spouse</SelectItem>
                              <SelectItem value="parent">Parent</SelectItem>
                              <SelectItem value="child">Child</SelectItem>
                              <SelectItem value="sibling">Sibling</SelectItem>
                              <SelectItem value="friend">Friend</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 7: Electronic Signature */}
            {currentStep === 7 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-blue-500" />
                    {INTAKE_STEPS[7].title}
                  </CardTitle>
                  <CardDescription>{INTAKE_STEPS[7].description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Terms and Conditions */}
                  <div className="space-y-4">
                    <div className="border rounded-lg p-4 max-h-48 overflow-y-auto bg-slate-50">
                      <h3 className="font-semibold mb-3">Terms and Conditions</h3>
                      <div className="text-sm space-y-2">
                        <p>By providing your electronic signature below, you agree to the following:</p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                          <li>You authorize TherapyBill AI to process and bill insurance claims on your behalf</li>
                          <li>You understand that co-pays and deductibles are your responsibility</li>
                          <li>You agree to provide accurate insurance and medical information</li>
                          <li>You consent to electronic communication regarding your account</li>
                          <li>You acknowledge that appointments require 24-hour cancellation notice</li>
                          <li>You understand that missed appointments may result in charges</li>
                        </ul>
                      </div>
                    </div>

                    <div className="border rounded-lg p-4 max-h-32 overflow-y-auto bg-slate-50">
                      <h3 className="font-semibold mb-3">Privacy Policy</h3>
                      <div className="text-sm space-y-2">
                        <p>Your privacy is important to us. We collect and use your information to:</p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                          <li>Provide therapy services and process insurance claims</li>
                          <li>Communicate about appointments and billing</li>
                          <li>Comply with healthcare regulations (HIPAA)</li>
                        </ul>
                        <p>We do not sell or share your personal information with third parties except as required for treatment and billing.</p>
                      </div>
                    </div>
                  </div>

                  {/* Electronic Signature Field */}
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="electronicSignature"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-base font-semibold">
                            Electronic Signature *
                          </FormLabel>
                          <FormControl>
                            <div className="space-y-2">
                              <Input
                                {...field}
                                placeholder="Type your full legal name as your electronic signature"
                                className="text-lg p-4 border-2 border-blue-200 focus:border-blue-500"
                                style={{ fontFamily: 'cursive' }}
                                data-testid="input-electronic-signature"
                              />
                              <p className="text-sm text-slate-600">
                                By typing your name above, you are providing an electronic signature that is legally equivalent to a handwritten signature.
                              </p>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Agreement Checkboxes */}
                    <div className="space-y-3">
                      <FormField
                        control={form.control}
                        name="agreesToTerms"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                checked={field.value}
                                onChange={field.onChange}
                                className="mt-1"
                                data-testid="checkbox-terms"
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="text-sm">
                                I agree to the Terms and Conditions *
                              </FormLabel>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="agreesToPrivacy"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                checked={field.value}
                                onChange={field.onChange}
                                className="mt-1"
                                data-testid="checkbox-privacy"
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="text-sm">
                                I agree to the Privacy Policy *
                              </FormLabel>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Signature Date */}
                    <div className="flex items-center justify-between text-sm text-slate-600 pt-4 border-t">
                      <span>Date of Signature:</span>
                      <span className="font-medium">{new Date().toLocaleDateString()}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 8: Review & Submit */}
            {currentStep === 8 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    {INTAKE_STEPS[8].title}
                  </CardTitle>
                  <CardDescription>{INTAKE_STEPS[8].description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Basic Information Summary */}
                    <div className="space-y-3">
                      <h3 className="font-semibold text-slate-900">Basic Information</h3>
                      <div className="space-y-2 text-sm">
                        <div><span className="font-medium">Name:</span> {form.watch("firstName")} {form.watch("lastName")}</div>
                        <div><span className="font-medium">DOB:</span> {form.watch("dateOfBirth")}</div>
                        <div><span className="font-medium">Phone:</span> {form.watch("phone")}</div>
                        <div><span className="font-medium">Email:</span> {form.watch("email") || "Not provided"}</div>
                        <div><span className="font-medium">Address:</span> {form.watch("address")}</div>
                      </div>
                    </div>

                    {/* Insurance Summary */}
                    <div className="space-y-3">
                      <h3 className="font-semibold text-slate-900">Insurance Information</h3>
                      <div className="space-y-2 text-sm">
                        <div><span className="font-medium">Provider:</span> {form.watch("insuranceProvider")}</div>
                        <div><span className="font-medium">Member ID:</span> {form.watch("insuranceId")}</div>
                        <div><span className="font-medium">Policy:</span> {form.watch("policyNumber")}</div>
                        <div><span className="font-medium">Group:</span> {form.watch("groupNumber") || "Not provided"}</div>
                      </div>
                    </div>

                    {/* Emergency Contact Summary */}
                    <div className="space-y-3">
                      <h3 className="font-semibold text-slate-900">Emergency Contact</h3>
                      <div className="space-y-2 text-sm">
                        <div><span className="font-medium">Name:</span> {form.watch("emergencyContactName")}</div>
                        <div><span className="font-medium">Phone:</span> {form.watch("emergencyContactPhone")}</div>
                        <div><span className="font-medium">Relationship:</span> {form.watch("emergencyContactRelation")}</div>
                      </div>
                    </div>

                    {/* Medical Information Summary */}
                    <div className="space-y-3">
                      <h3 className="font-semibold text-slate-900">Medical Information</h3>
                      <div className="space-y-2 text-sm">
                        <div><span className="font-medium">Primary Diagnosis:</span> {form.watch("primaryDiagnosis") || "Not provided"}</div>
                        <div><span className="font-medium">Referring Physician:</span> {form.watch("referringPhysician") || "Not provided"}</div>
                        <div><span className="font-medium">Medical History:</span> {form.watch("medicalHistory") ? "Provided" : "Not provided"}</div>
                        <div><span className="font-medium">Medications:</span> {form.watch("currentMedications") ? "Provided" : "Not provided"}</div>
                        <div><span className="font-medium">Allergies:</span> {form.watch("allergies") ? "Provided" : "Not provided"}</div>
                      </div>
                    </div>
                  </div>

                  {inputMethod !== "manual" && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <Brain className="w-5 h-5 text-blue-500 mt-0.5" />
                        <div>
                          <h4 className="font-medium text-blue-900">AI Data Extraction Used</h4>
                          <p className="text-sm text-blue-700 mt-1">
                            This patient information was extracted using {inputMethod === "voice" ? "voice dictation" : "document upload"}
                            and processed by our AI system. Please verify all information is accurate before submitting.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Validation Summary */}
                  {(() => {
                    const missingFields = [];
                    if (!form.watch("firstName")) missingFields.push("First Name");
                    if (!form.watch("lastName")) missingFields.push("Last Name");
                    if (!form.watch("dateOfBirth")) missingFields.push("Date of Birth");
                    if (!form.watch("phone")) missingFields.push("Phone Number");
                    if (!form.watch("address")) missingFields.push("Address");
                    if (!form.watch("insuranceProvider")) missingFields.push("Insurance Provider");
                    if (!form.watch("insuranceId")) missingFields.push("Insurance ID");
                    if (!form.watch("policyNumber")) missingFields.push("Policy Number");
                    if (!form.watch("emergencyContactName")) missingFields.push("Emergency Contact Name");
                    if (!form.watch("emergencyContactPhone")) missingFields.push("Emergency Contact Phone");
                    if (!form.watch("emergencyContactRelation")) missingFields.push("Emergency Contact Relationship");
                    if (!form.watch("cardNumber")) missingFields.push("Card Number");
                    if (!form.watch("expiryDate")) missingFields.push("Card Expiry Date");
                    if (!form.watch("cvv")) missingFields.push("CVV");
                    if (!form.watch("cardholderName")) missingFields.push("Cardholder Name");
                    if (!form.watch("billingAddress")) missingFields.push("Billing Address");
                    if (!form.watch("billingZip")) missingFields.push("Billing ZIP Code");
                    if (!form.watch("electronicSignature")) missingFields.push("Electronic Signature");
                    if (!form.watch("agreesToTerms")) missingFields.push("Agreement to Terms");
                    if (!form.watch("agreesToPrivacy")) missingFields.push("Agreement to Privacy Policy");

                    if (missingFields.length > 0) {
                      return (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
                            <div>
                              <h4 className="font-medium text-red-900">Missing Required Fields</h4>
                              <p className="text-sm text-red-700 mt-1">
                                Please complete the following before submitting:
                              </p>
                              <ul className="list-disc list-inside text-sm text-red-600 mt-2 space-y-1">
                                {missingFields.map((field) => (
                                  <li key={field}>{field}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                          <div>
                            <h4 className="font-medium text-green-900">All Required Fields Complete</h4>
                            <p className="text-sm text-green-700 mt-1">
                              You're ready to submit the patient intake form.
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between items-center pt-6">
              <Button
                type="button"
                variant="outline"
                onClick={prevStep}
                disabled={currentStep === 0}
                className="flex items-center gap-2"
                data-testid="button-previous-step"
              >
                <ArrowLeft className="w-4 h-4" />
                Previous
              </Button>

              <div className="text-sm text-slate-500">
                Step {currentStep + 1} of {INTAKE_STEPS.length}
              </div>

              {currentStep < INTAKE_STEPS.length - 1 ? (
                <Button
                  type="button"
                  onClick={nextStep}
                  className="flex items-center gap-2"
                  data-testid="button-next-step"
                >
                  Next
                  <ArrowRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={createPatientMutation.isPending}
                  className="flex items-center gap-2"
                  data-testid="button-submit-patient"
                >
                  {createPatientMutation.isPending ? "Adding Patient..." : "Add Patient"}
                  <CheckCircle className="w-4 h-4" />
                </Button>
              )}
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}