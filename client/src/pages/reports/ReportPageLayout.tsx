import { ReactNode } from "react";
import PageLayout from "@/components/PageLayout";

interface ReportPageLayoutProps {
  title: string;
  description?: string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  children: ReactNode;
  actions?: ReactNode;
}

/**
 * Thin wrapper over the global PageLayout that pins the "Back to Reports"
 * link. Kept so the 11 canned-report pages don't need to change.
 */
export default function ReportPageLayout(props: ReportPageLayoutProps) {
  return (
    <PageLayout
      {...props}
      backTo={{ href: "/reports", label: "Back to Reports" }}
      loadingMessage="Loading report…"
      errorMessage={props.errorMessage || "Failed to load report. Please try again."}
    />
  );
}
