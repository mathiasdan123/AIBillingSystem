/**
 * Claim detail modal totals follow the live claim, not the clicked row.
 *
 * QA sweep 2026-11-18: edit a draft claim's line from 3 to 2 units; the list
 * row showed $200 but the open modal's Billed Amount / Total Billed stayed
 * $300 until a reload, because the modal rendered the row snapshot it was
 * opened with. ClaimFullDetail now reads /api/claims/:id itself, which the
 * line-item mutations already invalidate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', practiceId: 1, role: 'admin' }, isAuthenticated: true, isLoading: false, isAdmin: true, hasFinancialAccess: true }),
}));
const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

import { ClaimFullDetail } from '../pages/claims';

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

// The row the user clicked: 3 units of 97110 at $100 = $300.
const SNAPSHOT: any = {
  id: 5,
  claimNumber: 'CLM-0005',
  practiceId: 1,
  patientId: 1,
  insuranceId: 1,
  status: 'draft',
  totalAmount: '300.00',
  paidAmount: null,
  createdAt: '2026-11-18T14:00:00.000Z',
};
// What the server now holds after the 3 → 2 unit edit.
let liveClaim: any = { ...SNAPSHOT, totalAmount: '200.00' };

const LINE_ITEMS = [
  { id: 11, cptCodeId: 1, cptCode: { code: '97110', description: 'Therapeutic Exercise' }, units: 2, rate: '100.00', amount: '200.00', dateOfService: '2026-11-18' },
];

function renderDetail(claimOverrides: any = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        queryFn: async ({ queryKey }) => {
          const res = await mockApiRequest('GET', (queryKey as string[]).join(''));
          return res.json();
        },
      },
    },
  });
  const noop = { mutate: vi.fn(), isPending: false } as any;
  return render(
    <QueryClientProvider client={queryClient}>
      <ClaimFullDetail
        claim={{ ...SNAPSHOT, ...claimOverrides }}
        lineItems={LINE_ITEMS}
        loadingLineItems={false}
        appeals={[]}
        loadingAppeals={false}
        getPatientName={() => 'Riley Nodob'}
        getInsuranceName={() => 'Aetna'}
        getStatusBadge={() => ''}
        submitSecondaryMutation={noop}
        regenerateAppealMutation={noop}
        cptCodes={[]}
        onLineItemAdded={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('ClaimFullDetail payment dates', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a posting\'s payment_date as the stored calendar day, not a day early in New York (billing pass 2026-11-19)', async () => {
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === '/api/claims/5') return jsonResponse(liveClaim);
      if (url.startsWith('/api/payment-postings')) {
        return jsonResponse([
          { id: 6, paymentAmount: '246.65', paymentDate: '2026-11-13', payerName: 'UnitedHealthcare', checkNumber: 'DEMO-CHK-2-1002', reversed: false },
        ]);
      }
      if (url.startsWith('/api/patients/')) return jsonResponse({ patientId: 1, balance: 0 });
      if (url.startsWith('/api/icd10-codes')) return jsonResponse([]);
      return jsonResponse({});
    });
    renderDetail();
    // Radix tabs activate on pointer down, not on click alone.
    const tab = screen.getByRole('tab', { name: 'Payments' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await screen.findByText('Nov 13, 2026')).toBeInTheDocument();
    // The old new Date('2026-11-13').toLocaleDateString() rendered 11/12/2026 west of UTC.
    expect(screen.queryByText(/11\/12\/2026/)).toBeNull();
    expect(screen.getByText('DEMO-CHK-2-1002')).toBeInTheDocument();
  });
});

describe('ClaimFullDetail billed totals', () => {
  beforeEach(() => {
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === '/api/claims/5') return jsonResponse(liveClaim);
      if (url.startsWith('/api/payment-postings')) return jsonResponse([]);
      if (url.startsWith('/api/patients/')) return jsonResponse({ patientId: 1, balance: 0 });
      if (url.startsWith('/api/icd10-codes')) return jsonResponse([]);
      return jsonResponse({});
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the live claim total ($200) rather than the clicked row snapshot ($300)', async () => {
    renderDetail();

    await waitFor(() => {
      expect(screen.getByText('Billed Amount').parentElement).toHaveTextContent('$200.00');
    });
    expect(screen.getByText('Total Billed:').parentElement).toHaveTextContent('$200.00');
    expect(screen.queryByText('$300.00')).toBeNull();
  });

  it('falls back to the snapshot until the live claim has loaded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === '/api/claims/5') { await gate; return jsonResponse(liveClaim); }
      return jsonResponse([]);
    });

    renderDetail();
    // First paint: snapshot value, so the modal is never blank.
    expect(screen.getByText('Billed Amount').parentElement).toHaveTextContent('$300.00');

    release();
    await waitFor(() => {
      expect(screen.getByText('Billed Amount').parentElement).toHaveTextContent('$200.00');
    });
  });
});

// Radix TabsTrigger activates on mousedown, not click.
function clickTab(testid: string) {
  const trigger = screen.getByTestId(testid);
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
}

/**
 * Appeals tab after "Create Appeal" (QA 2026-11-18): the claim's status is
 * 'appeal' and its record lives in the appeals table, but the tab was gated
 * on status === 'denied' and read only the legacy AI-recommendation rows, so
 * it said "Appeals are available for denied claims" with an appeal sitting
 * right there.
 */
describe('ClaimFullDetail appeals tab', () => {
  const FILED = [{ id: 31, claimId: 5, appealLevel: 'initial', status: 'ready', deadlineDate: '2027-01-17', appealedAmount: '300.00' }];

  function route(status: string, filed: any[]) {
    liveClaim = { ...SNAPSHOT, status };
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === '/api/claims/5') return jsonResponse(liveClaim);
      if (url === '/api/appeals?claimId=5') return jsonResponse(filed);
      if (url === '/api/claims/5/events') return jsonResponse([]);
      return jsonResponse([]);
    });
  }
  afterEach(() => { liveClaim = { ...SNAPSHOT, totalAmount: '200.00' }; vi.clearAllMocks(); });

  it("status 'appeal' with one filed appeal lists it, linked to its draft, and never shows the denied-only copy", async () => {
    route('appeal', FILED);
    renderDetail({ status: 'appeal' });
    clickTab('tab-appeals');

    const row = await screen.findByTestId('filed-appeal-31');
    expect(row).toHaveTextContent('Appeal #31');
    expect(row).toHaveTextContent('ready');
    expect(row).toHaveTextContent('Filing deadline 2027-01-17');
    expect(screen.getByTestId('link-appeal-31')).toHaveAttribute('href', '/appeals?appealId=31');
    expect(screen.queryByText('Appeals are available for denied claims')).toBeNull();
  });

  it("status 'denied' with no appeals shows the generate-an-appeal empty state", async () => {
    route('denied', []);
    renderDetail({ status: 'denied' });
    clickTab('tab-appeals');

    expect(await screen.findByText('No appeal generated yet')).toBeInTheDocument();
    expect(screen.queryByTestId('filed-appeals')).toBeNull();
    expect(screen.queryByText('Appeals are available for denied claims')).toBeNull();
  });

  it("a draft claim with no appeals keeps the 'available for denied claims' copy", async () => {
    route('draft', []);
    renderDetail({ status: 'draft' });
    clickTab('tab-appeals');

    expect(await screen.findByText('Appeals are available for denied claims')).toBeInTheDocument();
  });

  it("status 'denied' WITH a filed appeal shows the appeal above the AI recommendations", async () => {
    route('denied', FILED);
    renderDetail({ status: 'denied' });
    clickTab('tab-appeals');

    expect(await screen.findByTestId('filed-appeal-31')).toBeInTheDocument();
    expect(screen.getByText('AI Appeal Recommendations')).toBeInTheDocument();
  });
});

/**
 * Status timeline (QA 2026-11-18): only Created/Submitted rendered, from the
 * claim row. Recorded claim_events now render in order with their summary.
 */
describe('ClaimFullDetail status timeline', () => {
  const EVENTS = [
    { id: 1, eventType: 'submitted', summary: 'Submitted via stedi', metadata: { isResubmission: false }, createdAt: '2026-11-10T15:00:00.000Z' },
    { id: 2, eventType: 'denied', summary: 'Denied: CO-197: precertification absent', metadata: { denialReason: 'CO-197: precertification absent' }, createdAt: '2026-11-15T15:00:00.000Z' },
    { id: 3, eventType: 'appeal_created', summary: 'Appeal created (initial) — letter drafted, status ready; filing deadline 2027-01-17', metadata: { appealId: 31 }, createdAt: '2026-11-18T14:00:00.000Z' },
    { id: 4, eventType: 'note_added', summary: 'Internal note on appeal #31: Called Aetna; auth was on file.', metadata: { appealId: 31, excerpt: 'Called Aetna; auth was on file.' }, createdAt: '2026-11-18T15:00:00.000Z' },
    { id: 5, eventType: 'reopened', summary: 'Reopened to draft for correction: add prior auth number', metadata: { previousDenialReason: 'CO-197: precertification absent' }, createdAt: '2026-11-18T16:00:00.000Z' },
  ];

  afterEach(() => { liveClaim = { ...SNAPSHOT, totalAmount: '200.00' }; vi.clearAllMocks(); });

  it('renders denial, appeal, note and reopen events with their summaries, in order', async () => {
    liveClaim = { ...SNAPSHOT, status: 'draft', submittedAt: '2026-11-10T15:00:00.000Z' };
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === '/api/claims/5') return jsonResponse(liveClaim);
      if (url === '/api/claims/5/events') return jsonResponse(EVENTS);
      return jsonResponse([]);
    });
    renderDetail({ status: 'draft' });
    clickTab('tab-status');

    const denied = await screen.findByTestId('claim-event-denied');
    expect(denied).toHaveTextContent('Denied');
    expect(denied).toHaveTextContent('CO-197: precertification absent');

    const appeal = screen.getByTestId('claim-event-appeal_created');
    expect(appeal).toHaveTextContent('Appeal created');
    expect(appeal.querySelector('a')).toHaveAttribute('href', '/appeals?appealId=31');

    expect(screen.getByTestId('claim-event-note_added')).toHaveTextContent('Called Aetna; auth was on file.');

    const reopened = screen.getByTestId('claim-event-reopened');
    expect(reopened).toHaveTextContent('Reopened to draft');
    expect(reopened).toHaveTextContent('Denial reason before reopen: CO-197: precertification absent');

    // Order follows the stored history.
    const labels = Array.from(document.querySelectorAll('[data-testid^="claim-event-"]')).map((el) => el.getAttribute('data-testid'));
    expect(labels).toEqual(['claim-event-submitted', 'claim-event-denied', 'claim-event-appeal_created', 'claim-event-note_added', 'claim-event-reopened']);

    // The row-derived "Submitted" entry is not duplicated when a submitted event exists.
    expect(screen.getAllByText('Submitted')).toHaveLength(1);
  });

  it('falls back to the row-level denial when no events were recorded (pre-table claims)', async () => {
    liveClaim = { ...SNAPSHOT, status: 'denied', denialReason: 'CO-4: modifier inconsistent' };
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === '/api/claims/5') return jsonResponse(liveClaim);
      if (url === '/api/claims/5/events') return jsonResponse([]);
      return jsonResponse([]);
    });
    renderDetail({ status: 'denied' });
    clickTab('tab-status');

    expect(await screen.findByText('CO-4: modifier inconsistent')).toBeInTheDocument();
  });
});

/**
 * Payments tab on a denied claim (demo billing test 2026-11-19, item 5): a
 * $0 ERA denial with CAS CO-197 $100 showed "Adjustment: $100" and
 * "Write-off %: 100.0%" with no reason. The posting now carries the CARC,
 * and a denied claim's adjustment is labelled as a denial, not a write-off.
 */
describe('ClaimFullDetail payments tab — denial vs write-off', () => {
  afterEach(() => { liveClaim = { ...SNAPSHOT, totalAmount: '200.00' }; vi.clearAllMocks(); });

  const postings = (over: any = {}) => [{
    id: 9, paymentAmount: '0.00', adjustmentAmount: '100.00', patientResponsibility: '0.00', paymentDate: '2026-11-18',
    payerName: 'Aetna QA Synthetic', checkNumber: 'QA-SYN-1', source: 'era', reversed: false,
    adjustmentReason: 'CO-197: Contractual Obligations: Precertification/authorization/notification absent',
    remarkCode: null, ...over,
  }];

  function setup(status: string, denialReason: string | null, rows: any[]) {
    liveClaim = { ...SNAPSHOT, status, denialReason, totalAmount: '100.00', paidAmount: '0.00' };
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === '/api/claims/5') return jsonResponse(liveClaim);
      if (url.startsWith('/api/payment-postings')) return jsonResponse(rows);
      return jsonResponse([]);
    });
    renderDetail({ status, denialReason, totalAmount: '100.00' });
    clickTab('tab-payments');
  }

  it('a denied claim shows the CARC on the posting and a denial note instead of a write-off %', async () => {
    setup('denied', 'CO-197: Contractual Obligations: Precertification/authorization/notification absent', postings());

    const summary = await screen.findByTestId('adjustment-summary');
    expect(summary).toHaveTextContent('$100.00');
    expect(summary).not.toHaveTextContent('Write-off %');
    expect(screen.getByTestId('adjustment-denied-note')).toHaveTextContent(/Denied by the payer — CO-197/);
    expect(screen.getByTestId('adjustment-denied-note')).toHaveTextContent(/not a contractual write-off/);
    expect(screen.getByText(/Reason:/).parentElement).toHaveTextContent('CO-197: Contractual Obligations: Precertification/authorization/notification absent');
  });

  it('a paid claim with a contractual adjustment keeps the write-off %', async () => {
    setup('paid', null, postings({ paymentAmount: '160.00', adjustmentAmount: '90.00', adjustmentReason: 'CO-45: Contractual Obligations: Charge exceeds fee schedule/maximum allowable/contracted/legislated amount; PR-2: Patient Responsibility: Coinsurance amount' }));

    const summary = await screen.findByTestId('adjustment-summary');
    expect(summary).toHaveTextContent('Write-off %');
    expect(summary).toHaveTextContent('90.0%');
    expect(screen.queryByTestId('adjustment-denied-note')).toBeNull();
    expect(screen.getByText(/Reason:/).parentElement).toHaveTextContent('CO-45');
  });
});

/**
 * Status tab, Clearinghouse Response (demo retest 2026-11-19, cosmetic): a
 * long single-line response value widened the whole tab, forcing horizontal
 * scroll and clipping the Clearinghouse "Status:" / "Submitted:" values off
 * the right edge. The JSON now wraps inside a bounded box.
 */
describe('ClaimFullDetail status tab — clearinghouse response wraps', () => {
  afterEach(() => { liveClaim = { ...SNAPSHOT, totalAmount: '200.00' }; vi.clearAllMocks(); });

  const longToken = 'x'.repeat(600);

  function setup(clearinghouseResponse: unknown) {
    liveClaim = {
      ...SNAPSHOT, status: 'submitted', clearinghouseClaimId: 'STEDI-1', clearinghouseStatus: 'simulated',
      clearinghouseSubmittedAt: '2026-11-19T15:00:00.000Z', clearinghouseResponse,
    };
    mockApiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === '/api/claims/5') return jsonResponse(liveClaim);
      return jsonResponse([]);
    });
    renderDetail({ status: 'submitted' });
    clickTab('tab-status');
  }

  it('wraps a long response inside a bounded box and keeps the status fields in the normal flow', async () => {
    setup({ success: true, status: 'simulated', message: longToken });
    const pre = await screen.findByTestId('clearinghouse-response');
    expect(pre.className).toMatch(/whitespace-pre-wrap/);
    expect(pre.className).toMatch(/break-all/);
    expect(pre.className).toMatch(/max-w-full/);
    expect(pre.className).not.toMatch(/overflow-x-auto/);
    expect(pre.textContent).toContain('"status": "simulated"');
    expect(screen.getByText('Status:')).toBeInTheDocument();
    expect(screen.getByText('Submitted:')).toBeInTheDocument();
  });

  it('a string response that is not JSON is shown as is instead of crashing the tab', async () => {
    setup('TA1*ACK*not json');
    const pre = await screen.findByTestId('clearinghouse-response');
    expect(pre.textContent).toBe('TA1*ACK*not json');
  });
});

