/**
 * Cross-component control for the Blanche AI assistant.
 *
 * Why a DOM event instead of a context or state lib: Blanche is mounted once
 * at the App root; everything else (keyboard shortcut, sidebar button,
 * contextual page buttons) needs to ask her to open without owning her
 * state. A scoped custom event keeps the coupling loose — any caller can
 * `openBlanche()` without importing the component or adding a provider.
 */

export const BLANCHE_OPEN_EVENT = "blanche:open";

export interface BlancheOpenDetail {
  /** Optional message to pre-fill the input with when Blanche opens. */
  prefillMessage?: string;
}

export function openBlanche(detail: BlancheOpenDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BlancheOpenDetail>(BLANCHE_OPEN_EVENT, { detail }),
  );
}
