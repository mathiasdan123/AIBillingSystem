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
import { Upload, FileText, CheckCircle, Loader2, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const patientSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  dateOfBirth: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  insuranceProvider: z.string().optional(),
  insuranceId: z.string().optional(),
  policyNumber: z.string().optional(),
  groupNumber: z.string().optional(),
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
  const totalSteps = 4;

  const form = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
    defaultValues: {
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
    },
  });

  const createPatientMutation = useMutation({
    mutationFn: async (data: PatientFormData) => {
      const response = await apiRequest("POST", "/api/patients", {
        ...data,
        practiceId,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth).toISOString().split('T')[0] : null,
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
          // Don't fail the whole form if document upload fails
          toast({
            title: "Document Upload Issue",
            description: "Patient created, but document processing had an issue. The office will follow up.",
            variant: "destructive",
          });
        } finally {
          setUploadingDocument(false);
        }
      }

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
        description: "Failed to create patient",
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Progress Indicator */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  i <= step
                    ? "bg-medical-blue-500 text-white"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {i}
              </div>
            ))}
          </div>
          <div className="text-sm text-slate-600">
            Step {step} of {totalSteps}
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Personal Information</h3>
            
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
            </div>

            <FormField
              control={form.control}
              name="dateOfBirth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of Birth</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
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
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl>
                    <Input placeholder="(555) 123-4567" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end">
              <Button type="button" onClick={nextStep}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Address Information</h3>
            
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="123 Main St, City, State 12345" 
                      {...field} 
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>
                Previous
              </Button>
              <Button type="button" onClick={nextStep}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Insurance Information</h3>
            
            <FormField
              control={form.control}
              name="insuranceProvider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Insurance Provider</FormLabel>
                  <FormControl>
                    <Input placeholder="Blue Cross Blue Shield" {...field} />
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
                  <FormLabel>Member ID</FormLabel>
                  <FormControl>
                    <Input placeholder="ABC123456789" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                    <FormMessage />
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
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>
                Previous
              </Button>
              <Button type="button" onClick={nextStep}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
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
                    <p className="text-sm text-slate-600">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      PDF or image files up to 10MB
                    </p>
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
              <Button type="button" variant="outline" onClick={prevStep}>
                Previous
              </Button>
              <Button
                type="submit"
                disabled={createPatientMutation.isPending || uploadingDocument || (planDocument && !consentGiven)}
                className="bg-medical-blue-500 hover:bg-medical-blue-600"
              >
                {uploadingDocument ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing Document...
                  </>
                ) : createPatientMutation.isPending ? (
                  "Creating..."
                ) : planDocument ? (
                  "Submit & Upload Document"
                ) : (
                  "Complete Registration"
                )}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Form>
  );
}
