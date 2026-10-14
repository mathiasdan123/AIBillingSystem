import * as Sentry from "@sentry/react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { attemptGuardedReload, isChunkLoadError } from "@/lib/chunkReloadGuard";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  /** A stale-deploy chunk failure was detected and a guarded reload is in
   * flight — render a quiet loader instead of the error fallback. */
  reloading: boolean;
}

/**
 * Route-level error boundary (extracted from App.tsx).
 *
 * Besides the generic fallback, it self-heals the post-deploy failure mode
 * where a pre-deploy tab navigates to a lazily-loaded route whose chunk hash
 * no longer exists: React.lazy() rejects with a module-load error, which we
 * detect by message pattern and answer with one guarded page reload (shared
 * guard with the vite:preloadError listener in main.tsx, so the two paths
 * can't double-reload). If the guard refuses (a reload already happened
 * within the window — i.e. the new build itself is broken), the normal error
 * UI is shown instead of looping.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, reloading: false };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isChunkLoadError(error) && attemptGuardedReload()) {
      // Stale chunk after a deploy — the reload fetches the new bundle.
      // Expected operational noise, not an application error: skip Sentry.
      this.setState({ reloading: true });
      return;
    }

    console.error("ErrorBoundary caught an error:", error, errorInfo);
    // Report to Sentry if initialized (no-ops if DSN was not configured)
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack || undefined,
        },
      },
    });
  }

  render() {
    if (this.state.reloading) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-center p-6" role="status">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mb-4" />
          <p className="text-sm text-slate-600">A new version is available. Reloading…</p>
        </div>
      );
    }
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-center p-6" role="alert">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-slate-600 mb-4">An unexpected error occurred. Please try refreshing the page.</p>
          <button
            onClick={() => this.setState({ hasError: false, reloading: false })}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default RouteErrorBoundary;
