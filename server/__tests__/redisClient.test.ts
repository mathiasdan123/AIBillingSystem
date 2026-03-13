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
let shutdownRedis: typeof import('../services/redisClient').shutdownRedis;

async function loadModule() {
  vi.resetModules();
  const mod = await import('../services/redisClient');
  initRedisClient = mod.initRedisClient;
  getRedisClient = mod.getRedisClient;
  isRedisReady = mod.isRedisReady;
  shutdownRedis = mod.shutdownRedis;
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
});
