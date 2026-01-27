import { useEffect, useRef, useState, useCallback } from 'react';

const IDLE_TIMEOUT = 25 * 60 * 1000; // 25 minutes
const WARNING_DURATION = 5 * 60 * 1000; // 5 minutes

export function useIdleTimeout() {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningStartRef = useRef<number>(0);

  const resetTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (warningTimerRef.current) clearInterval(warningTimerRef.current);
    setShowWarning(false);

    idleTimerRef.current = setTimeout(() => {
      // Show warning
      setShowWarning(true);
      warningStartRef.current = Date.now();
      setRemainingSeconds(Math.floor(WARNING_DURATION / 1000));

      warningTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - warningStartRef.current;
        const remaining = Math.max(0, Math.floor((WARNING_DURATION - elapsed) / 1000));
        setRemainingSeconds(remaining);

        if (remaining <= 0) {
          // Auto-logout
          if (warningTimerRef.current) clearInterval(warningTimerRef.current);
          window.location.href = '/api/logout';
        }
      }, 1000);
    }, IDLE_TIMEOUT);
  }, []);

  const dismissWarning = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    const handleActivity = () => {
      if (!showWarning) {
        resetTimer();
      }
    };

    events.forEach(event => document.addEventListener(event, handleActivity, true));
    resetTimer();

    return () => {
      events.forEach(event => document.removeEventListener(event, handleActivity, true));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (warningTimerRef.current) clearInterval(warningTimerRef.current);
    };
  }, [resetTimer, showWarning]);

  return { showWarning, remainingSeconds, dismissWarning };
}
