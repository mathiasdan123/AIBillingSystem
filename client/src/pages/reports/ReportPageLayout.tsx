import { ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReportPageLayoutProps {
  title: string;
  description?: string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  children: ReactNode;
  actions?: ReactNode;
}

export default function ReportPageLayout({
  title,
  description,
  isLoading,
  isError,
  errorMessage,
  children,
  actions,
}: ReportPageLayoutProps) {
  const [, setLocation] = useLocation();

  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={() => setLocation("/reports")}
            data-testid="report-back-button"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Reports
          </Button>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">{title}</h1>
          {description && <p className="text-sm md:text-base text-muted-foreground mt-1">{description}</p>}
        </div>
        {actions && <div className="flex-shrink-0">{actions}</div>}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading report…
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-destructive">
          {errorMessage || "Failed to load report. Please try again."}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
