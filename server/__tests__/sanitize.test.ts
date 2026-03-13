import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { requestSanitizer } from '../middleware/sanitize';
import type { Request, Response, NextFunction } from 'express';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    query: {},
    params: {},
    method: 'POST',
    path: '/test',
    ...overrides,
  } as unknown as Request;
}

describe('Request Sanitizer Middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it('calls next for clean data without modification', () => {
    const req = createMockReq({ body: { name: 'Alice', age: 30 } });
    requestSanitizer()(req, {} as Response, next);
    expect(req.body.name).toBe('Alice');
    expect(next).toHaveBeenCalled();
  });

  it('strips null bytes from body strings', () => {
    const req = createMockReq({ body: { name: 'Al\x00ice' } });
    requestSanitizer()(req, {} as Response, next);
    expect(req.body.name).toBe('Alice');
    expect(next).toHaveBeenCalled();
  });

  it('strips null bytes from query strings', () => {
    const req = createMockReq({ query: { search: 'test\x00value' } as any });
    requestSanitizer()(req, {} as Response, next);
    expect(req.query.search).toBe('testvalue');
  });

  it('strips null bytes from params', () => {
    const req = createMockReq({ params: { id: '12\x003' } as any });
    requestSanitizer()(req, {} as Response, next);
    expect(req.params.id).toBe('123');
  });

  it('truncates strings exceeding 10KB', () => {
    const longString = 'x'.repeat(11 * 1024);
    const req = createMockReq({ body: { data: longString } });
    requestSanitizer()(req, {} as Response, next);
    expect(req.body.data.length).toBe(10 * 1024);
  });

  it('handles nested objects', () => {
    const req = createMockReq({
      body: {
        patient: {
          name: 'Bob\x00by',
          address: { city: 'New\x00 York' },
        },
      },
    });
    requestSanitizer()(req, {} as Response, next);
    expect(req.body.patient.name).toBe('Bobby');
    expect(req.body.patient.address.city).toBe('New York');
  });

  it('handles arrays with null bytes', () => {
    const req = createMockReq({
      body: { items: ['clean', 'has\x00null', 'also\x00bad'] },
    });
    requestSanitizer()(req, {} as Response, next);
    expect(req.body.items).toEqual(['clean', 'hasnull', 'alsobad']);
  });

  it('passes through non-string values unchanged', () => {
    const req = createMockReq({
      body: { count: 42, active: true, nothing: null },
    });
    requestSanitizer()(req, {} as Response, next);
    expect(req.body.count).toBe(42);
    expect(req.body.active).toBe(true);
    expect(req.body.nothing).toBeNull();
  });

  it('handles empty body gracefully', () => {
    const req = createMockReq({ body: {} });
    requestSanitizer()(req, {} as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('handles deeply nested objects up to depth limit', () => {
    // Build a deeply nested object (12 levels) - sanitizer stops at depth 10
    let obj: any = { value: 'deep\x00clean' };
    for (let i = 0; i < 12; i++) {
      obj = { nested: obj };
    }
    const req = createMockReq({ body: obj });
    requestSanitizer()(req, {} as Response, next);
    // The middleware should call next regardless of depth
    expect(next).toHaveBeenCalled();
  });
});
