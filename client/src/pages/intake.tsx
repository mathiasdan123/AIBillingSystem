import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList } from "lucide-react";
import PatientIntakeForm from "@/components/PatientIntakeForm";

/**
 * Patient Intake page (/intake).
 *
 * Thin wrapper around the canonical PatientIntakeForm component — the same
 * one rendered inside the "Add Patient" dialog on the Patients page. That
 * component has AI-powered insurance card scanning (Claude Vision), plan
 * document OCR, and the full multi-step intake flow. Previously this page
 * rendered a separate, simpler form missing those features.
 *
 * Keeping this as a dedicated route so the sidebar "Patient Intake" nav
 * link has somewhere to go, and users can deep-link to the intake flow
 * without opening the Patients page first.
 */
export default function PatientIntake() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  // Resolve the practice id for the logged-in user; fall back to 1 for demo.
  const practiceId = (user as any)?.practiceId ?? 1;

  const handleSuccess = () => {
    toast({
      title: "Patient added",
      description: "New patient was saved successfully.",
    });
    setLocation("/patients");
  };

  return (
    <div className="container max-w-4xl mx-auto py-6 px-4 md:py-10 md:px-6">
      <div className="flex items-start gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
          <ClipboardList className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Patient Intake</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Add a new patient step-by-step. Includes insurance card scanning and plan document upload.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Patient</CardTitle>
          <CardDescription>
            Fill out the sections below. The system will scan any insurance card photos
            you upload and pre-fill member ID, group number, and payer name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PatientIntakeForm
            practiceId={practiceId}
            onSuccess={handleSuccess}
          />
        </CardContent>
      </Card>
    </div>
  );
}
