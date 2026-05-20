import { describe, it, expect } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/aiLearningService', () => ({}));
vi.mock('../services/practiceContext', () => ({ getUserPracticeContext: vi.fn() }));

import { vi } from 'vitest';
import { buildSystemPrompt } from '../routes/ai-assistant';

describe('buildSystemPrompt', () => {
  it('always includes the base prompt and the Today block', () => {
    const prompt = buildSystemPrompt({ asString: true, });
    expect(prompt).toMatch(/Your name is Blanche\./);
    expect(prompt).toMatch(/## Today/);
    // No user context block when neither role nor pageContext is supplied.
    expect(prompt).not.toMatch(/## User Context/);
  });

  describe('Today block (date awareness)', () => {
    it('injects today\'s date in YYYY-MM-DD format', () => {
      const fixed = new Date('2026-05-18T15:00:00Z');
      const prompt = buildSystemPrompt({ asString: true,  now: fixed });
      expect(prompt).toMatch(/Date: 2026-05-18/);
    });

    it('tells Blanche not to ask the user for today\'s date', () => {
      const prompt = buildSystemPrompt({ asString: true,  now: new Date('2026-05-18T15:00:00Z') });
      expect(prompt).toMatch(/Never ask the user for today's date/);
    });

    it('computes "tomorrow" relative to "now" so Blanche can resolve "tomorrow" correctly', () => {
      const prompt = buildSystemPrompt({ asString: true,  now: new Date('2026-05-18T15:00:00Z') });
      expect(prompt).toMatch(/tomorrow.*2026-05-19/);
    });

    it('uses the client-supplied local date when provided (TZ-aware)', () => {
      // Server-UTC clock has rolled into May 19, but the user (PDT) is still
      // on May 18. clientDate=2026-05-18 should override the server clock so
      // Blanche says "today = May 18, tomorrow = May 19".
      const serverUtc = new Date('2026-05-19T03:00:00Z');
      const prompt = buildSystemPrompt({ asString: true,  now: serverUtc, clientDate: '2026-05-18' });
      expect(prompt).toMatch(/Date: 2026-05-18/);
      expect(prompt).toMatch(/tomorrow.*2026-05-19/);
    });

    it('ignores a malformed clientDate and falls back to server time', () => {
      const fixed = new Date('2026-05-18T15:00:00Z');
      const prompt = buildSystemPrompt({ asString: true,  now: fixed, clientDate: 'not-a-date' });
      expect(prompt).toMatch(/Date: 2026-05-18/);
    });
  });

  it('injects an admin-specific opener for role=admin', () => {
    const prompt = buildSystemPrompt({ asString: true,  role: 'admin' });
    expect(prompt).toMatch(/## User Context/);
    expect(prompt).toMatch(/practice ADMIN\/OWNER/);
    // Sanity: still contains base content
    expect(prompt).toMatch(/Your name is Blanche\./);
  });

  it('injects a therapist-specific opener for role=therapist', () => {
    const prompt = buildSystemPrompt({ asString: true,  role: 'therapist' });
    expect(prompt).toMatch(/THERAPIST\/CLINICIAN/);
    expect(prompt).not.toMatch(/practice ADMIN\/OWNER/);
  });

  it('injects a billing-specific opener for role=billing', () => {
    const prompt = buildSystemPrompt({ asString: true,  role: 'billing' });
    expect(prompt).toMatch(/BILLING \/ FRONT-DESK/);
    expect(prompt).not.toMatch(/practice ADMIN\/OWNER/);
    expect(prompt).not.toMatch(/THERAPIST\/CLINICIAN/);
  });

  it('is case-insensitive on role lookup', () => {
    const prompt = buildSystemPrompt({ asString: true,  role: 'ADMIN' });
    expect(prompt).toMatch(/practice ADMIN\/OWNER/);
  });

  it('emits a page-context line when pageContext is supplied', () => {
    const prompt = buildSystemPrompt({ asString: true, 
      pageContext: { path: '/patients', title: 'Patients' },
    });
    expect(prompt).toMatch(/## User Context/);
    expect(prompt).toMatch(/Current page: Patients/);
    expect(prompt).toMatch(/\/patients/);
    expect(prompt).toMatch(/what can I do here\?/);
  });

  it('handles partial page context (title only)', () => {
    const prompt = buildSystemPrompt({ asString: true, 
      pageContext: { path: null, title: 'SOAP Notes' },
    });
    expect(prompt).toMatch(/Current page: SOAP Notes/);
    // No trailing parens when path is missing
    expect(prompt).not.toMatch(/SOAP Notes \(\)/);
  });

  it('combines role + page context in the same block', () => {
    const prompt = buildSystemPrompt({ asString: true, 
      role: 'therapist',
      pageContext: { path: '/calendar', title: 'Calendar' },
    });
    expect(prompt).toMatch(/THERAPIST\/CLINICIAN/);
    expect(prompt).toMatch(/Current page: Calendar/);
  });

  it('ignores an unknown role gracefully (no User Context block from role alone)', () => {
    const prompt = buildSystemPrompt({ asString: true,  role: 'cleaning_staff' });
    expect(prompt).not.toMatch(/## User Context/);
    expect(prompt).toMatch(/Your name is Blanche\./);
  });

  it('removed the hardcoded 5-step list (regression — Blanche must call the tool)', () => {
    // The old prompt enumerated 5 steps inline. Phase 2 moves the truth source
    // to the get_practice_setup_status tool. The base prompt should no longer
    // contain that exact enumeration.
    const prompt = buildSystemPrompt({ asString: true, });
    expect(prompt).not.toMatch(/1\. Add a patient\s*\n.*2\. Schedule a session/s);
    expect(prompt).toMatch(/CALL the get_practice_setup_status tool FIRST/);
  });

  describe('array form (caching layout)', () => {
    it('returns two text blocks: stable BASE first (cached), volatile preamble second', () => {
      const blocks = buildSystemPrompt({ role: 'admin' });
      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks).toHaveLength(2);
      // [0] is the cached prefix — must contain BASE content and the cache marker
      expect(blocks[0].type).toBe('text');
      expect(blocks[0].text).toMatch(/Your name is Blanche\./);
      expect((blocks[0] as any).cache_control).toEqual({ type: 'ephemeral' });
      // [1] is the volatile per-request content — no cache marker
      expect(blocks[1].type).toBe('text');
      expect(blocks[1].text).toMatch(/## Today/);
      expect(blocks[1].text).toMatch(/practice ADMIN\/OWNER/);
      expect((blocks[1] as any).cache_control).toBeUndefined();
    });

    it('keeps the cached BASE block byte-identical across requests with different volatile inputs', () => {
      // The whole point of the layout — the marker is only useful if the
      // bytes before it are stable. Today's date, role, and page changing
      // must NOT affect blocks[0].
      const a = buildSystemPrompt({
        role: 'admin',
        pageContext: { path: '/patients', title: 'Patients' },
        now: new Date('2026-05-18T15:00:00Z'),
      });
      const b = buildSystemPrompt({
        role: 'therapist',
        pageContext: { path: '/calendar', title: 'Calendar' },
        now: new Date('2026-05-19T15:00:00Z'),
      });
      expect(a[0].text).toBe(b[0].text);
      expect(a[1].text).not.toBe(b[1].text);
    });
  });
});
