import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mock for ioredis
const mockOn = vi.hoisted(() => vi.fn().mockReturnThis());
const mockQuit = vi.hoisted(() => vi.fn().mockResolvedValue('OK'));
const mockDisconnect = vi.hoisted(() => vi.fn());
const MockRedis = vi.hoisted(() =>
  vi.fn(() => ({
    on: mockOn,
    quit: mockQuit,
    disconnect: mockDisconnect,
  })),
);

vi.mock('ioredis', () => ({
  default: MockRedis,
}));

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let initRedisClient: typeof import('../services/redisClient').initRedisClient;
let getRedisClient: typeof import('../services/redisClient').getRedisClient;
let isRedisReady: typeof import('../services/redisClient').isRedisReady;
let isRedisConfigured: typeof import('../services/redisClient').isRedisConfigured;
let shutdownRedis: typeof import('../services/redisClient').shutdownRedis;

async function loadModule() {
  vi.resetModules();
  const mod = await import('../services/redisClient');
  initRedisClient = mod.initRedisClient;
  getRedisClient = mod.getRedisClient;
  isRedisReady = mod.isRedisReady;
  isRedisConfigured = mod.isRedisConfigured;
  shutdownRedis = mod.shutdownRedis;
}

/** Simulate ioredis firing an event by invoking the handler `.on(event, ...)` registered. */
function fireEvent(event: string, ...args: any[]) {
  const call = mockOn.mock.calls.find((c: any[]) => c[0] === event);
  if (!call) throw new Error(`No handler registered for '${event}'`);
  call[1](...args);
}

describe('Redis Client', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it('returns null when REDIS_URL is not set', async () => {
    await loadModule();
    const client = initRedisClient();
    expect(client).toBeNull();
    expect(MockRedis).not.toHaveBeenCalled();
  });

  it('creates a Redis client when REDIS_URL is set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    await loadModule();
    const client = initRedisClient();
    expect(client).not.toBeNull();
    expect(MockRedis).toHaveBeenCalledWith('redis://localhost:6379', expect.any(Object));
  });

  it('returns the same client on subsequent calls (singleton)', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    await loadModule();
    const client1 = initRedisClient();
    const client2 = initRedisClient();
    expect(client1).toBe(client2);
    expect(MockRedis).toHaveBeenCalledTimes(1);
  });

  it('registers event listeners on the client', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    await loadModule();
    initRedisClient();
    const eventNames = mockOn.mock.calls.map((call: any[]) => call[0]);
    expect(eventNames).toContain('connect');
    expect(eventNames).toContain('ready');
    expect(eventNames).toContain('error');
    expect(eventNames).toContain('close');
    expect(eventNames).toContain('reconnecting');
  });

  it('isRedisReady returns false when no client exists', async () => {
    await loadModule();
    expect(isRedisReady()).toBe(false);
  });

  it('getRedisClient returns null before initialization', async () => {
    await loadModule();
    expect(getRedisClient()).toBeNull();
  });

  it('shutdownRedis calls quit on the client', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    await loadModule();
    initRedisClient();
    await shutdownRedis();
    expect(mockQuit).toHaveBeenCalled();
    expect(getRedisClient()).toBeNull();
  });

  it('shutdownRedis is safe to call when no client exists', async () => {
    await loadModule();
    await expect(shutdownRedis()).resolves.toBeUndefined();
  });

  describe('isRedisConfigured', () => {
    it('returns false when no client exists', async () => {
      await loadModule();
      expect(isRedisConfigured()).toBe(false);
    });

    it('returns true once a client object is created, even before the ready event fires', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      await loadModule();
      initRedisClient();
      // No 'ready' event fired yet - isRedisReady() is still false, but a
      // client object exists and ioredis queues commands by default.
      expect(isRedisReady()).toBe(false);
      expect(isRedisConfigured()).toBe(true);
    });

    it('stays true across a transient error/reconnect, unlike isRedisReady (regression: 2026-10-25 Blanche proposal 404)', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      await loadModule();
      initRedisClient();
      fireEvent('ready');
      expect(isRedisReady()).toBe(true);
      expect(isRedisConfigured()).toBe(true);

      // A single dropped connection ioredis's own retryStrategy recovers
      // from - the exact scenario that caused a proposal written while
      // isRedisReady() read true to be looked up a moment later while it
      // read false, routing the lookup to the (empty) in-memory store
      // instead of Redis, where the proposal actually still was.
      fireEvent('error', new Error('ECONNRESET'));
      expect(isRedisReady()).toBe(false);
      expect(isRedisConfigured()).toBe(true);
    });

    it('returns false after shutdownRedis', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      await loadModule();
      initRedisClient();
      await shutdownRedis();
      expect(isRedisConfigured()).toBe(false);
    });
  });
});
