import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock Sentry before importing the boundary
vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
  browserTracingIntegration: vi.fn(),
  replayIntegration: vi.fn(),
}));

// Mock the reload guard so no real window.location.reload happens; the guard's
// own behavior (sessionStorage window, vite:preloadError) is covered in
// chunkReloadGuard.test.ts.
vi.mock('@/lib/chunkReloadGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chunkReloadGuard')>();
  return {
    ...actual,
    attemptGuardedReload: vi.fn(() => true),
  };
});

import * as Sentry from '@sentry/react';
import { attemptGuardedReload } from '@/lib/chunkReloadGuard';
import { RouteErrorBoundary as ErrorBoundary } from '@/components/RouteErrorBoundary';

// A component that throws on render
function ThrowingComponent({ shouldThrow = true, message = 'Test render error' }: { shouldThrow?: boolean; message?: string }) {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <div>No error</div>;
}

const CHUNK_ERROR_MESSAGE =
  'Failed to fetch dynamically imported module: https://app.therapybillai.com/assets/settings-oldhash.js';

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(attemptGuardedReload).mockReturnValue(true);
    // Suppress console.error noise from React error boundary logging
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <p>Hello world</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders multiple children without error', () => {
    render(
      <ErrorBoundary>
        <span>Child A</span>
        <span>Child B</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Child A')).toBeInTheDocument();
    expect(screen.getByText('Child B')).toBeInTheDocument();
  });

  it('shows fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText('An unexpected error occurred. Please try refreshing the page.'),
    ).toBeInTheDocument();
  });

  it('renders a "Try again" button in the fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('resets error state when "Try again" is clicked and re-renders children', () => {
    const flag = { shouldThrow: true };
    function ConditionalThrower() {
      if (flag.shouldThrow) {
        throw new Error('controlled error');
      }
      return <div>Recovered successfully</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    flag.shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    rerender(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Recovered successfully')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('reports error to Sentry via captureException', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        contexts: expect.objectContaining({
          react: expect.any(Object),
        }),
      }),
    );
  });

  it('does not attempt a reload for ordinary errors', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );
    expect(attemptGuardedReload).not.toHaveBeenCalled();
  });

  it('does not show fallback for non-throwing children', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('No error')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('stale-deploy chunk-load errors', () => {
    it('triggers a guarded reload and shows the reloading state instead of the error UI', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent message={CHUNK_ERROR_MESSAGE} />
        </ErrorBoundary>,
      );

      expect(attemptGuardedReload).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText(/reloading/i)).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
      // Expected operational noise after a deploy — not reported to Sentry.
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('falls back to the error UI when the reload guard suppresses the reload (broken build)', () => {
      vi.mocked(attemptGuardedReload).mockReturnValue(false);

      render(
        <ErrorBoundary>
          <ThrowingComponent message={CHUNK_ERROR_MESSAGE} />
        </ErrorBoundary>,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      // A second chunk failure within the guard window means the new build
      // itself is broken — this one IS worth reporting.
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
  });
});
