import { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageLayoutProps {
  /** Page title — rendered as the h1. */
  title: string;
  /** Optional sub-title shown under the title. */
  description?: string;
  /** Optional right-aligned header content (buttons, filters). */
  actions?: ReactNode;
  /** Optional back-link rendered above the title. */
  backTo?: { href: string; label: string };
  /** When true, renders the shared loading state instead of children. */
  isLoading?: boolean;
  loadingMessage?: string;
  /** When true, renders the shared error state instead of children. */
  isError?: boolean;
  errorMessage?: string;
  /** When provided alongside isError, shows a Retry button. */
  onRetry?: () => void;
  children: ReactNode;
}

/**
 * The canonical page shell. Owns the sidebar offset, responsive padding, and
 * the standard header / loading / error states so individual pages don't
 * each reinvent them. Extracted from the reports module's ReportPageLayout,
 * which proved the pattern.
 */
export default function PageLayout({
  title,
  description,
  actions,
  backTo,
  isLoading,
  loadingMessage = "Loading…",
  isError,
  errorMessage,
  onRetry,
  children,
}: PageLayoutProps) {
  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          {backTo && (
            <Link href={backTo.href}>
              <Button variant="ghost" size="sm" className="mb-2 -ml-2">
                <ArrowLeft className="w-4 h-4 mr-1" /> {backTo.label}
              </Button>
            </Link>
          )}
          <h1 className="text-xl md:text-2xl font-bold text-foreground">{title}</h1>
          {description && (
            <p className="text-sm md:text-base text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        {actions && <div className="flex-shrink-0">{actions}</div>}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> {loadingMessage}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-destructive">
          <p>{errorMessage || "Failed to load. Please try again."}</p>
          {onRetry && (
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
