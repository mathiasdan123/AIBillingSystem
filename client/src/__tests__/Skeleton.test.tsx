import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Skeleton,
  DashboardSkeleton,
  TableSkeleton,
  CardGridSkeleton,
} from '@/components/ui/skeleton';

describe('Skeleton', () => {
  it('renders a div with animate-pulse class', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.className).toContain('animate-pulse');
  });

  it('applies rounded-md and bg-muted base classes', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild!;
    expect(el.className).toContain('rounded-md');
    expect(el.className).toContain('bg-muted');
  });

  it('merges custom className', () => {
    const { container } = render(<Skeleton className="h-8 w-64" />);
    const el = container.firstElementChild!;
    expect(el.className).toContain('h-8');
    expect(el.className).toContain('w-64');
    // base classes still present
    expect(el.className).toContain('animate-pulse');
  });

  it('forwards extra HTML attributes', () => {
    const { container } = render(<Skeleton data-testid="skel" id="s1" />);
    const el = container.firstElementChild!;
    expect(el.getAttribute('data-testid')).toBe('skel');
    expect(el.getAttribute('id')).toBe('s1');
  });
});

describe('DashboardSkeleton', () => {
  it('renders without errors', () => {
    const { container } = render(<DashboardSkeleton />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it('contains multiple skeleton pulse elements', () => {
    const { container } = render(<DashboardSkeleton />);
    const pulses = container.querySelectorAll('.animate-pulse');
    // Header (2) + 4 stat cards (3 each=12) + 2 content cards with rows
    expect(pulses.length).toBeGreaterThanOrEqual(10);
  });

  it('renders 4 stat cards in a grid', () => {
    const { container } = render(<DashboardSkeleton />);
    // The grid with 4 stat cards
    const grid = container.querySelector('.grid.grid-cols-1');
    expect(grid).toBeTruthy();
  });
});

describe('TableSkeleton', () => {
  it('renders without errors', () => {
    const { container } = render(<TableSkeleton />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it('renders header row and 5 body rows (6 rows total)', () => {
    const { container } = render(<TableSkeleton />);
    const rows = container.querySelectorAll('.border-b');
    // 1 header + 5 body rows
    expect(rows.length).toBe(6);
  });

  it('renders 5 columns per row', () => {
    const { container } = render(<TableSkeleton />);
    const firstRow = container.querySelector('.border-b')!;
    const cols = firstRow.querySelectorAll('.animate-pulse');
    expect(cols.length).toBe(5);
  });
});

describe('CardGridSkeleton', () => {
  it('renders without errors', () => {
    const { container } = render(<CardGridSkeleton />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it('renders 6 skeleton cards', () => {
    const { container } = render(<CardGridSkeleton />);
    // The grid container is the first child; each card is a direct child
    const grid = container.firstElementChild!;
    expect(grid.children.length).toBe(6);
  });

  it('applies responsive grid classes', () => {
    const { container } = render(<CardGridSkeleton />);
    const grid = container.firstElementChild!;
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('lg:grid-cols-3');
  });
});
