/**
 * QA 2026-11-18 (follow-up to #474): while a patient is archived, their
 * existing review request read "Patient #1" because the page resolved names
 * from the default patient list, which excludes archived patients since
 * #472. The list used for name lookups must include archived patients; the
 * Request Review picker must still leave them out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', practiceId: 1, role: 'admin' },
    isAuthenticated: true,
    isLoading: false,
    isAdmin: true,
    hasFinancialAccess: true,
  }),
}));

import ReviewsPage from '../pages/reviews';

const ARCHIVED_AVA = { id: 1, firstName: 'Ava', lastName: 'Sample', practiceId: 1, archivedAt: '2026-11-18T15:00:00.000Z' };
const ACTIVE_LIAM = { id: 2, firstName: 'Liam', lastName: 'Demo', practiceId: 1, archivedAt: null };

const AVA_REQUEST = {
  id: 1,
  practiceId: 1,
  patientId: 1,
  status: 'sent',
  sentVia: 'email',
  emailSent: true,
  smsSent: false,
  sentAt: '2026-11-10T14:00:00.000Z',
  createdAt: '2026-11-10T14:00:00.000Z',
};

const REVIEW_STATS = {
  requests: { totalSent: 1, pending: 1, clicked: 0, reviewed: 0, declined: 0, clickRate: 0, reviewRate: 0 },
  reviews: { totalReviews: 0, averageRating: 0, pendingResponses: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0, ratingDistribution: {} },
};
const FEEDBACK_STATS = {
  totalFeedback: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0,
  unaddressedNegative: 0, googlePostsPending: 0, googlePostsCompleted: 0, averageRating: 0,
};

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function renderReviews() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ReviewsPage />
    </QueryClientProvider>,
  );
}

describe('Reviews: patient name for an archived patient', () => {
  const patientListRequests: string[] = [];

  beforeEach(() => {
    patientListRequests.length = 0;
    // cmdk scrolls the highlighted item into view; jsdom has no layout.
    Element.prototype.scrollIntoView = vi.fn();
    // reviews.tsx fetches everything with bare fetch().
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/patients')) {
          patientListRequests.push(url);
          // Mirrors the server: archived patients come back only when asked for.
          return jsonResponse(url.includes('archived=include') ? [ARCHIVED_AVA, ACTIVE_LIAM] : [ACTIVE_LIAM]);
        }
        if (url.startsWith('/api/reviews/requests')) return jsonResponse([AVA_REQUEST]);
        if (url.startsWith('/api/reviews/stats')) return jsonResponse(REVIEW_STATS);
        if (url.startsWith('/api/feedback/stats')) return jsonResponse(FEEDBACK_STATS);
        if (url.startsWith('/api/practices/')) return jsonResponse({ id: 1, name: 'Demo Practice' });
        return jsonResponse([]);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const openRequestsTab = async () => {
    const tab = await screen.findByRole('tab', { name: /review requests/i });
    // Radix tabs activate on mousedown.
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
  };

  it('asks for the patient list including archived patients', async () => {
    renderReviews();
    await openRequestsTab();
    await screen.findByText('Ava Sample');
    expect(patientListRequests.some((u) => u.includes('archived=include'))).toBe(true);
  });

  it("shows the archived patient's real name on the review request, not \"Patient #1\"", async () => {
    renderReviews();
    await openRequestsTab();
    expect(await screen.findByText('Ava Sample')).toBeInTheDocument();
    expect(screen.queryByText(/Patient #1/)).toBeNull();
  });

  it('the Request Review patient picker still leaves the archived patient out', async () => {
    renderReviews();
    fireEvent.click(await screen.findByRole('button', { name: /request review/i }));
    // A combobox takes no accessible name from its content, so find the
    // trigger by its placeholder text.
    fireEvent.click((await screen.findByText('Search or type patient name...')).closest('button')!);

    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Liam Demo')).toBeInTheDocument();
    expect(within(list).queryByText('Ava Sample')).toBeNull();
  });
});
