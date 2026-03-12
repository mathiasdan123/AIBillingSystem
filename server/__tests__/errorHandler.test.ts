import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock Sentry
vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
  Handlers: { requestHandler: vi.fn(() => vi.fn()), errorHandler: vi.fn(() => vi.fn()) },
}));

// Mock logger
vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { sendError, globalErrorHandler, ErrorCodes } from '../middleware/errorHandler';

function createMockRes() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

function createMockReq(overrides: any = {}): Partial<Request> {
  return {
    method: 'GET',
    path: '/api/test',
    headers: {},
    ...overrides,
  } as any;
}

describe('Error Handler Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- sendError ----

  it('should send a standardized error response with correct status code', () => {
    const res = createMockRes();
    sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid input');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid input' },
    });
  });

  it('should include details field when provided', () => {
    const res = createMockRes();
    const details = { field: 'email', reason: 'must be valid' };
    sendError(res, 422, ErrorCodes.VALIDATION_ERROR, 'Validation failed', details);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: { field: 'email', reason: 'must be valid' },
      },
    });
  });

  it('should NOT include details field when undefined', () => {
    const res = createMockRes();
    sendError(res, 404, ErrorCodes.NOT_FOUND, 'Resource not found');
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.error).not.toHaveProperty('details');
  });

  it('should send 401 unauthorized error', () => {
    const res = createMockRes();
    sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Not authenticated');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'UNAUTHORIZED' }),
      }),
    );
  });

  it('should send 403 forbidden error', () => {
    const res = createMockRes();
    sendError(res, 403, ErrorCodes.FORBIDDEN, 'Access denied');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].error.code).toBe('FORBIDDEN');
  });

  it('should send 429 rate limited error', () => {
    const res = createMockRes();
    sendError(res, 429, ErrorCodes.RATE_LIMITED, 'Too many requests');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].error.code).toBe('RATE_LIMITED');
  });

  it('should always set success: false', () => {
    const res = createMockRes();
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Server error');
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  // ---- globalErrorHandler ----

  it('should handle 500 errors with a generic public message', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();
    const err = new Error('Database connection pool exhausted');

    globalErrorHandler(err, req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // Must NOT leak internal error message
    expect(body.error.message).not.toContain('Database');
    expect(body.error.message).toBe('An internal error occurred. Please try again later.');
  });

  it('should use the error message for client errors (4xx)', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();
    const err: any = new Error('Invalid patient ID format');
    err.status = 400;

    globalErrorHandler(err, req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Invalid patient ID format');
  });

  it('should map status 401 to UNAUTHORIZED code', () => {
    const req = createMockReq();
    const res = createMockRes();
    const err: any = new Error('Token expired');
    err.status = 401;

    globalErrorHandler(err, req as Request, res as Response, vi.fn());

    expect(res.json.mock.calls[0][0].error.code).toBe('UNAUTHORIZED');
  });

  it('should map status 403 to FORBIDDEN code', () => {
    const req = createMockReq();
    const res = createMockRes();
    const err: any = new Error('Insufficient permissions');
    err.statusCode = 403;

    globalErrorHandler(err, req as Request, res as Response, vi.fn());

    expect(res.json.mock.calls[0][0].error.code).toBe('FORBIDDEN');
  });

  it('should map status 404 to NOT_FOUND code', () => {
    const req = createMockReq();
    const res = createMockRes();
    const err: any = new Error('Patient not found');
    err.status = 404;

    globalErrorHandler(err, req as Request, res as Response, vi.fn());

    expect(res.json.mock.calls[0][0].error.code).toBe('NOT_FOUND');
  });

  it('should map status 408 to TIMEOUT code', () => {
    const req = createMockReq();
    const res = createMockRes();
    const err: any = new Error('Request timed out');
    err.status = 408;

    globalErrorHandler(err, req as Request, res as Response, vi.fn());

    expect(res.json.mock.calls[0][0].error.code).toBe('TIMEOUT');
  });

  it('should map status 429 to RATE_LIMITED code', () => {
    const req = createMockReq();
    const res = createMockRes();
    const err: any = new Error('Rate limited');
    err.status = 429;

    globalErrorHandler(err, req as Request, res as Response, vi.fn());

    expect(res.json.mock.calls[0][0].error.code).toBe('RATE_LIMITED');
  });

  it('should use x-request-id header when requestId is not on req', () => {
    const req = createMockReq({ headers: { 'x-request-id': 'req-abc-123' } });
    const res = createMockRes();
    const err = new Error('fail');

    globalErrorHandler(err, req as Request, res as Response, vi.fn());

    // The handler should log with the request ID (we can verify it ran without error)
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should handle non-Error objects as errors', () => {
    const req = createMockReq();
    const res = createMockRes();
    const err = 'something went wrong'; // plain string, not Error instance

    globalErrorHandler(err, req as Request, res as Response, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
