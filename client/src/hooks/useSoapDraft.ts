import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

/**
 * Autosave hook for in-progress SOAP notes.
 *
 * - Fetches the existing draft when patientId changes (calls `onRestore` if found).
 * - Debounces autosave: waits AUTOSAVE_DEBOUNCE_MS after the last `save()` call
 *   before hitting the server, so rapid typing doesn't hammer the API.
 * - Exposes `lastSavedAt` for a "Draft saved Xs ago" indicator.
 * - `clear()` deletes the draft after the user signs/saves the final note.
 *
 * Backend: server/routes/soap-drafts.ts
 */

const AUTOSAVE_DEBOUNCE_MS = 10_000;

export interface SoapDraftPayload {
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  progressNotes?: string | null;
  homeProgram?: string | null;
  interventions?: unknown;
  location?: string | null;
  sessionType?: string | null;
  sessionId?: number | null;
}

export interface RestoredDraft extends SoapDraftPayload {
  id: number;
  lastSavedAt: string | null;
}

interface UseSoapDraftOpts {
  patientId: number | null;
  onRestore?: (draft: RestoredDraft) => void;
}

export function useSoapDraft({ patientId, onRestore }: UseSoapDraftOpts) {
  const [draftId, setDraftId] = useState<number | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<SoapDraftPayload | null>(null);
  // `patientId` captured at debounce-arming time so a patient switch doesn't
  // save one patient's text into another patient's draft.
  const armedPatientRef = useRef<number | null>(null);

  // Restore on patient change.
  useEffect(() => {
    if (!patientId) {
      setDraftId(null);
      setLastSavedAt(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/soap-drafts?patientId=${patientId}`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (res.status === 404) {
          setDraftId(null);
          setLastSavedAt(null);
          return;
        }
        if (!res.ok) {
          setError(`Failed to load draft (${res.status})`);
          return;
        }
        const draft: RestoredDraft = await res.json();
        setDraftId(draft.id);
        setLastSavedAt(draft.lastSavedAt ? new Date(draft.lastSavedAt) : null);
        onRestore?.(draft);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load draft");
      }
    })();
    return () => {
      cancelled = true;
    };
    // onRestore intentionally not in deps — callers usually pass an inline fn
  }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    if (!pendingRef.current || !armedPatientRef.current) return;
    const payload = pendingRef.current;
    const targetPatientId = armedPatientRef.current;
    pendingRef.current = null;
    setIsSaving(true);
    setError(null);
    try {
      const res = await apiRequest("PUT", "/api/soap-drafts", {
        patientId: targetPatientId,
        ...payload,
      });
      const draft: RestoredDraft = await res.json();
      setDraftId(draft.id);
      setLastSavedAt(new Date());
    } catch (e: any) {
      setError(e?.message ?? "Failed to save draft");
    } finally {
      setIsSaving(false);
    }
  }, []);

  const save = useCallback(
    (payload: SoapDraftPayload) => {
      if (!patientId) return;
      pendingRef.current = payload;
      armedPatientRef.current = patientId;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    },
    [patientId, flush],
  );

  const clear = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingRef.current = null;
    const id = draftId;
    setDraftId(null);
    setLastSavedAt(null);
    if (!id) return;
    try {
      await apiRequest("DELETE", `/api/soap-drafts/${id}`);
    } catch {
      // Best-effort — discarding a draft that's already gone is fine.
    }
  }, [draftId]);

  // Flush pending save on unmount so a navigation away doesn't lose work.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        void flush();
      }
    };
  }, [flush]);

  return { save, clear, lastSavedAt, isSaving, error, draftId };
}
