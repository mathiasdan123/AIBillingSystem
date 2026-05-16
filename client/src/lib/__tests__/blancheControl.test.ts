import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  openBlanche,
  BLANCHE_OPEN_EVENT,
  type BlancheOpenDetail,
} from '../blancheControl';

describe('openBlanche', () => {
  let listener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listener = vi.fn();
    window.addEventListener(BLANCHE_OPEN_EVENT, listener as EventListener);
  });

  afterEach(() => {
    window.removeEventListener(BLANCHE_OPEN_EVENT, listener as EventListener);
  });

  it('dispatches the BLANCHE_OPEN_EVENT on window', () => {
    openBlanche();
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe(BLANCHE_OPEN_EVENT);
  });

  it('passes prefillMessage through the event detail', () => {
    openBlanche({ prefillMessage: 'Help me with denials' });
    const event = listener.mock.calls[0][0] as CustomEvent<BlancheOpenDetail>;
    expect(event.detail?.prefillMessage).toBe('Help me with denials');
  });

  it('defaults to an empty detail when called with no args', () => {
    openBlanche();
    const event = listener.mock.calls[0][0] as CustomEvent<BlancheOpenDetail>;
    expect(event.detail).toEqual({});
  });

  it('emits a fresh event on each call (not deduped)', () => {
    openBlanche();
    openBlanche({ prefillMessage: 'x' });
    openBlanche();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
