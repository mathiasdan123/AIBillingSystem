import { describe, it, expect } from 'vitest';
import { parsePagination, paginatedResponse } from '../utils/pagination';

describe('parsePagination', () => {
  it('returns defaults when query is empty', () => {
    const result = parsePagination({});
    expect(result).toEqual({ page: 1, limit: 50, offset: 0 });
  });

  it('parses valid page and limit from query strings', () => {
    const result = parsePagination({ page: '3', limit: '25' });
    expect(result).toEqual({ page: 3, limit: 25, offset: 50 });
  });

  it('clamps page to minimum of 1 for negative values', () => {
    const result = parsePagination({ page: '-5', limit: '10' });
    expect(result.page).toBe(1);
    expect(result.offset).toBe(0);
  });

  it('clamps page to minimum of 1 for zero', () => {
    const result = parsePagination({ page: '0' });
    expect(result.page).toBe(1);
  });

  it('falls back to default for zero, clamps negative to 1', () => {
    // parseInt('0') = 0, which is falsy, so || falls back to defaultLimit (50)
    const result = parsePagination({ limit: '0' });
    expect(result.limit).toBe(50);

    // parseInt('-10') = -10, which is truthy, so Math.max(1, -10) = 1
    const result2 = parsePagination({ limit: '-10' });
    expect(result2.limit).toBe(1);
  });

  it('clamps limit to maxLimit when exceeding', () => {
    const result = parsePagination({ limit: '500' });
    expect(result.limit).toBe(200);
  });

  it('respects custom defaultLimit and maxLimit', () => {
    const result = parsePagination({}, 20, 100);
    expect(result.limit).toBe(20);

    const result2 = parsePagination({ limit: '150' }, 20, 100);
    expect(result2.limit).toBe(100);
  });

  it('calculates offset correctly for higher pages', () => {
    const result = parsePagination({ page: '5', limit: '10' });
    expect(result.offset).toBe(40);
  });

  it('handles non-numeric strings gracefully', () => {
    const result = parsePagination({ page: 'abc', limit: 'xyz' });
    expect(result).toEqual({ page: 1, limit: 50, offset: 0 });
  });

  it('handles undefined values in query', () => {
    const result = parsePagination({ page: undefined, limit: undefined });
    expect(result).toEqual({ page: 1, limit: 50, offset: 0 });
  });
});

describe('paginatedResponse', () => {
  it('returns correct structure with data and pagination metadata', () => {
    const data = [{ id: 1 }, { id: 2 }];
    const result = paginatedResponse(data, 50, 1, 10);

    expect(result.data).toEqual(data);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 50,
      totalPages: 5,
      hasMore: true,
    });
  });

  it('sets hasMore to false on the last page', () => {
    const result = paginatedResponse([], 20, 2, 10);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.totalPages).toBe(2);
  });

  it('handles total of 0', () => {
    const result = paginatedResponse([], 0, 1, 10);
    expect(result.pagination.totalPages).toBe(0);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.total).toBe(0);
  });

  it('calculates totalPages with ceiling division', () => {
    const result = paginatedResponse([], 11, 1, 5);
    expect(result.pagination.totalPages).toBe(3);
  });
});
