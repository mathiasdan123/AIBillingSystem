import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { setStaticCacheHeaders } from '../static';

/**
 * Regression tests for the cache-header rules that prevent stale-bundle
 * deploys. Layer 1 of the post-deploy-visibility fix:
 *
 *   /assets/*  →  public, max-age=31536000, immutable
 *   anything else served by express.static  →  no-cache, no-store, etc.
 *   /api/*  →  no-store, private (PHI must never be cached)
 *
 * If any of these stop being set, returning users will keep seeing the old
 * UI after a deploy, and PHI could end up in browser disk cache.
 */

describe('setStaticCacheHeaders', () => {
  // Direct unit test of the header-setting helper — guards against someone
  // refactoring serveStatic and accidentally dropping the asset rule.
  it('marks /assets/* files as immutable', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
    setStaticCacheHeaders(res, path.join('dist', 'public', 'assets', 'index-abc123.js'));
    expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  it('marks non-asset files as no-cache', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
    setStaticCacheHeaders(res, path.join('dist', 'public', 'index.html'));
    expect(headers['Cache-Control']).toBe('no-cache, no-store, must-revalidate, max-age=0');
  });

  it('marks favicon and other root files as no-cache', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
    setStaticCacheHeaders(res, path.join('dist', 'public', 'favicon.ico'));
    expect(headers['Cache-Control']).toBe('no-cache, no-store, must-revalidate, max-age=0');
  });
});

describe('static serving with cache headers (integration)', () => {
  let tmpDir: string;
  let app: express.Express;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-headers-test-'));
    fs.mkdirSync(path.join(tmpDir, 'assets'));
    fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html><body>shell</body></html>');
    fs.writeFileSync(path.join(tmpDir, 'assets', 'main-abc123.js'), 'console.log("hashed bundle");');
    fs.writeFileSync(path.join(tmpDir, 'favicon.ico'), 'fake-icon');

    app = express();
    app.use(express.static(tmpDir, { setHeaders: setStaticCacheHeaders }));
    app.use('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.sendFile(path.resolve(tmpDir, 'index.html'));
    });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves hashed bundles with year-long immutable cache', async () => {
    const res = await request(app).get('/assets/main-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serves index.html with no-cache', async () => {
    const res = await request(app).get('/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate, max-age=0');
  });

  it('serves favicon with no-cache', async () => {
    const res = await request(app).get('/favicon.ico');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate, max-age=0');
  });

  it('SPA fallback returns index.html with no-cache', async () => {
    const res = await request(app).get('/some/deep/spa/route');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate, max-age=0');
    expect(res.text).toContain('shell');
  });
});

describe('/api/* no-store middleware (integration)', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    // Replica of the middleware in server/index.ts. Kept inline so this test
    // doesn't have to boot the whole app (auth, sessions, DB, etc.).
    app.use('/api', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    });
    app.get('/api/anything', (_req, res) => res.json({ ok: true }));
    app.get('/api/patients/1', (_req, res) => res.json({ id: 1, firstName: 'Test' }));
    app.get('/not-api', (_req, res) => res.send('public'));
  });

  it('forces no-store on every /api response', async () => {
    const res = await request(app).get('/api/anything');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
    expect(res.headers['pragma']).toBe('no-cache');
    expect(res.headers['expires']).toBe('0');
  });

  it('protects PHI-bearing endpoints from intermediary caching', async () => {
    const res = await request(app).get('/api/patients/1');
    expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
  });

  it('does not affect non-api responses', async () => {
    const res = await request(app).get('/not-api');
    expect(res.headers['cache-control']).toBeUndefined();
  });
});
