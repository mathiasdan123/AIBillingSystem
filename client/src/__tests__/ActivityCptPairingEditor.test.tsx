/**
 * Per-activity CPT selector (Kelli's hard condition): every suggested code
 * is rendered next to its activity and is always editable, drawing from the
 * practice CPT catalog. Conservative-default pairings are visibly flagged,
 * and the accuracy disclaimer (therapist makes every coding decision) is
 * always present.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ActivityCptPairing } from '@shared/activityCpt';
import ActivityCptPairingEditor from '@/components/ActivityCptPairingEditor';

// Mock radix Select since jsdom can't handle portals (repo pattern).
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, value }: any) => (
    <div data-testid="mock-select">
      {children}
      <select
        data-testid="native-select"
        value={value || ''}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        <option value="97530">97530</option>
        <option value="97112">97112</option>
        <option value="97110">97110</option>
        <option value="97535">97535</option>
      </select>
    </div>
  ),
  SelectTrigger: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  SelectContent: ({ children }: any) => <div data-testid="select-options">{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

const pairings: ActivityCptPairing[] = [
  {
    activity: 'Platform Swing - Balance',
    code: '97112',
    name: 'Neuromuscular Re-education',
    rationale: 'Balance and postural control objective.',
    source: 'ai',
  },
  {
    activity: 'Novel Custom Activity',
    code: '97530',
    name: 'Therapeutic Activities',
    rationale: 'Conservative default — nothing more specific clearly supported.',
    source: 'default',
  },
];

const catalog = [
  { id: 1, code: '97530', description: 'Therapeutic activities' },
  { id: 2, code: '97112', description: 'Neuromuscular reeducation' },
  { id: 3, code: '97535', description: 'Self-care/home management training' },
];

describe('ActivityCptPairingEditor', () => {
  it('renders each activity paired with its suggested code', () => {
    render(<ActivityCptPairingEditor pairings={pairings} catalog={catalog} onCodeChange={vi.fn()} />);

    expect(screen.getByText('Platform Swing - Balance')).toBeInTheDocument();
    expect(screen.getByText('Novel Custom Activity')).toBeInTheDocument();

    const selects = screen.getAllByTestId('native-select') as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    expect(selects[0].value).toBe('97112');
    expect(selects[1].value).toBe('97530');

    // The selector draws its options from the practice CPT catalog.
    const optionLists = screen.getAllByTestId('select-options');
    expect(within(optionLists[0]).getByText('97535 — Self-care/home management training')).toBeInTheDocument();
  });

  it('flags conservative-default pairings for review', () => {
    render(<ActivityCptPairingEditor pairings={pairings} catalog={catalog} onCodeChange={vi.fn()} />);
    expect(screen.getByTestId('badge-conservative-default-Novel Custom Activity')).toHaveTextContent(
      /conservative default/i,
    );
    // The AI-mapped pairing is not flagged.
    expect(screen.queryByTestId('badge-conservative-default-Platform Swing - Balance')).not.toBeInTheDocument();
  });

  it('lets the therapist change any code and reports the edit', () => {
    const onCodeChange = vi.fn();
    render(<ActivityCptPairingEditor pairings={pairings} catalog={catalog} onCodeChange={onCodeChange} />);

    const selects = screen.getAllByTestId('native-select');
    fireEvent.change(selects[1], { target: { value: '97535' } });

    expect(onCodeChange).toHaveBeenCalledWith('Novel Custom Activity', '97535');
  });

  it('always shows the accuracy disclaimer — the treating provider decides', () => {
    render(<ActivityCptPairingEditor pairings={pairings} catalog={catalog} onCodeChange={vi.fn()} />);
    expect(screen.getByTestId('pairing-disclaimer')).toHaveTextContent(
      /the treating provider reviews and\s*approves all coding decisions/i,
    );
  });

  it('renders nothing when there are no pairings', () => {
    const { container } = render(
      <ActivityCptPairingEditor pairings={[]} catalog={catalog} onCodeChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
