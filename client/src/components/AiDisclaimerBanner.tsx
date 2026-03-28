import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AiDisclaimerBanner() {
  return (
    <Alert className="mb-4 border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
      <AlertDescription className="text-sm text-blue-800 dark:text-blue-200">
        TherapyBill AI assists with billing accuracy by suggesting codes based on clinical
        documentation. All coding decisions must be reviewed and approved by the treating provider.
      </AlertDescription>
    </Alert>
  );
}
