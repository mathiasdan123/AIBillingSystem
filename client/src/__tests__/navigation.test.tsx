import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// --- Mocks ---

let mockLocation = '/';
const mockSetLocation = vi.fn();

vi.mock('wouter', () => ({
  useLocation: () => [mockLocation, mockSetLocation] as const,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // Return readable labels for nav items
      const map: Record<string, string> = {
        'nav.dashboard': 'Dashboard',
        'nav.patients': 'Patients',
        'nav.claims': 'Claims',
        'nav.calendar': 'Calendar',
        'nav.patientIntake': 'Patient Intake',
        'nav.settings': 'Settings',
        'nav.logOut': 'Log Out',
        'nav.skipToMain': 'Skip to main content',
        'nav.mainNavigation': 'Main Navigation',
        'nav.mobileNavigation': 'Mobile Navigation',
        'theme.light': 'Light',
        'theme.dark': 'Dark',
        'theme.system': 'System',
        'locations.allLocations': 'All Locations',
      };
      return map[key] || key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
    isAdmin: true,
    currentRole: 'admin',
  }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
  ThemeProvider: ({ children }: any) => children,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: vi.fn(),
  QueryClient: vi.fn(),
  QueryClientProvider: ({ children }: any) => children,
}));

// Mock radix select (used by LanguageSwitcher & location picker)
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

// Stub global fetch so useQuery / fetch calls don't fail
global.fetch = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
);

import SimpleNavigation from '@/components/SimpleNavigation';

describe('SimpleNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation = '/';
  });

  it('renders the brand name', () => {
    render(<SimpleNavigation />);
    // Both desktop and mobile headers show the brand
    const brands = screen.getAllByText('TherapyBill AI');
    expect(brands.length).toBeGreaterThanOrEqual(1);
  });

  it('renders desktop sidebar nav items', () => {
    render(<SimpleNavigation />);
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Patients').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Claims').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Settings').length).toBeGreaterThanOrEqual(1);
  });

  it('highlights the active nav item with aria-current="page"', () => {
    mockLocation = '/patients';
    render(<SimpleNavigation />);
    // The desktop sidebar link for Patients should have aria-current
    const links = screen.getAllByText('Patients');
    const activeLink = links.find(
      (el) => el.closest('a')?.getAttribute('aria-current') === 'page',
    );
    expect(activeLink).toBeTruthy();
  });

  it('does not mark non-active items with aria-current', () => {
    mockLocation = '/';
    render(<SimpleNavigation />);
    const settingsLinks = screen.getAllByText('Settings');
    settingsLinks.forEach((el) => {
      expect(el.closest('a')?.getAttribute('aria-current')).not.toBe('page');
    });
  });

  it('renders mobile bottom tab bar with Dashboard, Patients, Claims, Calendar', () => {
    render(<SimpleNavigation />);
    // Mobile bottom tabs are <nav> with aria-label "Mobile Navigation"
    const mobileNav = screen.getByLabelText('Mobile Navigation');
    expect(mobileNav).toBeInTheDocument();

    // Bottom tab items
    const dashboardTabs = screen.getAllByText('Dashboard');
    const patientsTabs = screen.getAllByText('Patients');
    const claimsTabs = screen.getAllByText('Claims');
    const calendarTabs = screen.getAllByText('Calendar');

    // Each should appear at least twice (sidebar + bottom tab)
    expect(dashboardTabs.length).toBeGreaterThanOrEqual(2);
    expect(patientsTabs.length).toBeGreaterThanOrEqual(2);
    expect(claimsTabs.length).toBeGreaterThanOrEqual(2);
    expect(calendarTabs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders "More" button in mobile tab bar', () => {
    render(<SimpleNavigation />);
    expect(screen.getByLabelText('More navigation options')).toBeInTheDocument();
  });

  it('calls setLocation when a nav item is clicked', () => {
    render(<SimpleNavigation />);
    // Click the first "Patients" link (desktop sidebar)
    const patientsLink = screen.getAllByText('Patients')[0].closest('a')!;
    fireEvent.click(patientsLink);
    expect(mockSetLocation).toHaveBeenCalledWith('/patients');
  });

  it('renders skip-to-main-content link for accessibility', () => {
    render(<SimpleNavigation />);
    const skipLink = screen.getByText('Skip to main content');
    expect(skipLink).toBeInTheDocument();
    expect(skipLink.getAttribute('href')).toBe('#main-content');
  });

  it('shows user display name', () => {
    render(<SimpleNavigation />);
    // The user's full name "Jane Doe" appears in the sidebar user section
    const nameElements = screen.getAllByText('Jane Doe');
    expect(nameElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the log out button', () => {
    render(<SimpleNavigation />);
    const logoutButtons = screen.getAllByLabelText('Log Out');
    expect(logoutButtons.length).toBeGreaterThanOrEqual(1);
  });
});
