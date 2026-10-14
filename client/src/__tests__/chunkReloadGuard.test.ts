import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  attemptGuardedReload,
  installChunkReloadListener,
  isChunkLoadError,
  RELOAD_WINDOW_MS,
} from '@/lib/chunkReloadGuard';

/**
 * Stale-deploy self-healing: a tab loaded before a deploy fails to fetch a
 * lazily-loaded chunk (old hash is gone, server answers index.html). Vite
 * dispatches `vite:preloadError`; we reload once, guarded by a sessionStorage
 * timestamp so a genuinely broken build can't reload-loop.
 */

describe('chunkReloadGuard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isChunkLoadError', () => {
    it.each([
      'Failed to fetch dynamically imported module: https://app.therapybillai.com/assets/settings-abc123.js',
      'Importing a module script failed.',
      'error loading dynamically imported module',
      "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\".",
      'Loading chunk vendor-xyz failed',
      'Unable to preload CSS for /assets/claims-def456.css',
    ])('matches chunk-load error: %s', (message) => {
      expect(isChunkLoadError(new Error(message))).toBe(true);
    });

    it('does not match ordinary application errors', () => {
      expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
      expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false);
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError(undefined)).toBe(false);
    });
  });

  describe('attemptGuardedReload', () => {
    it('reloads and records the attempt in sessionStorage', () => {
      const reload = vi.fn();

      expect(attemptGuardedReload(reload)).toBe(true);

      expect(reload).toHaveBeenCalledTimes(1);
      expect(Number(sessionStorage.getItem('chunk-reload-at'))).toBe(Date.now());
    });

    it('suppresses a second reload inside the guard window (no reload loop)', () => {
      const reload = vi.fn();

      expect(attemptGuardedReload(reload)).toBe(true);
      expect(attemptGuardedReload(reload)).toBe(false);

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('allows another reload after the guard window has passed', () => {
      const reload = vi.fn();

      expect(attemptGuardedReload(reload)).toBe(true);
      vi.advanceTimersByTime(RELOAD_WINDOW_MS + 1);
      expect(attemptGuardedReload(reload)).toBe(true);

      expect(reload).toHaveBeenCalledTimes(2);
    });
  });

  describe('installChunkReloadListener (vite:preloadError)', () => {
    let uninstall: (() => void) | undefined;

    afterEach(() => {
      uninstall?.();
      uninstall = undefined;
    });

    it('reloads once on a synthetic vite:preloadError and swallows the event', () => {
      const reload = vi.fn();
      uninstall = installChunkReloadListener(reload);

      const event = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(event);

      expect(reload).toHaveBeenCalledTimes(1);
      // preventDefault tells Vite not to rethrow — we are reloading anyway.
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not swallow the event when the guard suppresses the reload', () => {
      const reload = vi.fn();
      uninstall = installChunkReloadListener(reload);

      window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
      const second = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(second);

      expect(reload).toHaveBeenCalledTimes(1);
      // The error must propagate so the ErrorBoundary can render a fallback
      // instead of the page hanging blank on an unresolvable lazy import.
      expect(second.defaultPrevented).toBe(false);
    });
  });
});
