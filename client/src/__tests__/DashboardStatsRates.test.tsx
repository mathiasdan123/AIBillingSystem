import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardStats from '@/components/DashboardStats';

const base = {
  totalClaims: 40,
  transmittedClaims: 11,
  successRate: 27.3,
  totalRevenue: 1000,
  avgDaysToPayment: null,
  monthlyClaimsCount: 5,
  monthlyRevenue: 1200,
  denialRate: 18.2,
  pendingClaims: 6,
  claimsAtComplianceRisk: 0,
};

describe('DashboardStats paid rate', () => {
  it('labels the rate as a current-status share of sent claims next to the denial rate', () => {
    render(<DashboardStats stats={base} />);
    expect(screen.getByText('Paid Rate')).toBeTruthy();
    expect(screen.queryByText('Success Rate')).toBeNull();
    expect(screen.getByText('27.3%')).toBeTruthy();
    expect(screen.getByText('currently paid, of sent claims · 18.2% currently denied')).toBeTruthy();
  });

  it('shows average days to payment as unavailable instead of a number', () => {
    render(<DashboardStats stats={base} />);
    expect(screen.getByText('Avg. Days to Payment')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.getByText('Not calculated yet')).toBeTruthy();
    expect(screen.queryByText('14.2')).toBeNull();
  });

  it('still shows a real value once one is provided', () => {
    render(<DashboardStats stats={{ ...base, avgDaysToPayment: 21 }} />);
    expect(screen.getByText('21')).toBeTruthy();
    expect(screen.queryByText('Unavailable')).toBeNull();
  });

  it('does not show a warning-coloured icon for a low paid rate', () => {
    const { container } = render(<DashboardStats stats={{ ...base, successRate: 12 }} />);
    expect(container.innerHTML).not.toMatch(/red-|amber-/);
  });

  it('names the month on the revenue figure', () => {
    render(<DashboardStats stats={base} />);
    const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    expect(screen.getByText(`Claim payments received, ${month}`)).toBeTruthy();
  });
});
