import { useIdleTimeout } from '@/hooks/useIdleTimeout';

export default function IdleTimeoutWarning() {
  const { showWarning, remainingSeconds, dismissWarning } = useIdleTimeout();

  if (!showWarning) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4 text-center space-y-4">
        <h2 className="text-lg font-semibold">Session Timeout Warning</h2>
        <p className="text-sm text-muted-foreground">
          Your session will expire due to inactivity in{' '}
          <span className="font-mono font-bold text-red-600">
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
        </p>
        <button
          onClick={dismissWarning}
          className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Stay Logged In
        </button>
      </div>
    </div>
  );
}
