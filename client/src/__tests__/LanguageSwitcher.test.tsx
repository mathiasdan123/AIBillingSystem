import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock react-i18next before importing the component
const changeLanguageMock = vi.fn();
let mockLanguage = 'en';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: mockLanguage,
      changeLanguage: changeLanguageMock,
    },
  }),
}));

// Mock the Select components from radix to make them testable
// The real radix Select uses portals and complex internals that jsdom can't handle.
// We render a simplified version that exercises the same logic paths.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select" data-value={value}>
      {typeof children === 'function' ? children({ value, onValueChange }) : children}
      {/* Hidden native select for testing value changes */}
      <select
        data-testid="native-select"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
    </div>
  ),
  SelectTrigger: ({ children, className, ...props }: any) => (
    <button data-testid="select-trigger" className={className} {...props}>
      {children}
    </button>
  ),
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-testid={`select-item-${value}`}>{children}</div>
  ),
  SelectValue: () => <span data-testid="select-value" />,
}));

import LanguageSwitcher from '@/components/LanguageSwitcher';
import { fireEvent } from '@testing-library/react';

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguage = 'en';
  });

  it('renders without crashing', () => {
    const { container } = render(<LanguageSwitcher />);
    expect(container).toBeTruthy();
  });

  it('renders both English and Español options', () => {
    render(<LanguageSwitcher />);
    expect(screen.getByTestId('select-item-en')).toHaveTextContent('English');
    expect(screen.getByTestId('select-item-es')).toHaveTextContent('Español');
  });

  it('renders the Globe icon (svg)', () => {
    const { container } = render(<LanguageSwitcher />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('calls changeLanguage when a new language is selected', () => {
    render(<LanguageSwitcher />);
    const select = screen.getByTestId('native-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'es' } });
    expect(changeLanguageMock).toHaveBeenCalledWith('es');
  });

  it('renders in normal (non-compact) mode by default', () => {
    render(<LanguageSwitcher />);
    const trigger = screen.getByTestId('select-trigger');
    // Non-compact trigger has explicit width class w-[140px]
    expect(trigger.className).toContain('w-[140px]');
  });

  it('renders in compact mode when compact prop is true', () => {
    render(<LanguageSwitcher compact />);
    const trigger = screen.getByTestId('select-trigger');
    // Compact trigger has w-auto and no border
    expect(trigger.className).toContain('w-auto');
    expect(trigger.className).toContain('border-none');
  });

  it('sets aria-label on non-compact trigger', () => {
    render(<LanguageSwitcher />);
    const trigger = screen.getByTestId('select-trigger');
    expect(trigger.getAttribute('aria-label')).toBe('language.selectLanguage');
  });

  it('does not set aria-label on compact trigger', () => {
    render(<LanguageSwitcher compact />);
    const trigger = screen.getByTestId('select-trigger');
    // Compact mode does not pass aria-label prop
    expect(trigger.getAttribute('aria-label')).toBeNull();
  });

  it('passes current language as value to Select', () => {
    mockLanguage = 'es';
    render(<LanguageSwitcher />);
    const select = screen.getByTestId('select');
    expect(select.getAttribute('data-value')).toBe('es');
  });
});
