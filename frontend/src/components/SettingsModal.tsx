import { Button } from "./ui/button";

interface SettingsModalProps {
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isBackendOnline: boolean | undefined;
  recheckBackendHealth: () => void;
  isCheckingHealth: boolean;
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => void;
  userId: string;
}

export function SettingsModal({
  isSettingsOpen,
  setIsSettingsOpen,
  isBackendOnline,
  recheckBackendHealth,
  isCheckingHealth,
  apiBaseUrl,
  setApiBaseUrl,
  userId,
}: SettingsModalProps) {
  if (!isSettingsOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-45 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-sm overflow-hidden shadow-xl animate-in zoom-in-95 duration-150 text-zinc-800 dark:text-zinc-100">
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-850 px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50">
          <span className="font-semibold text-sm">Configuration Settings</span>
          <button
            onClick={() => setIsSettingsOpen(false)}
            className="text-zinc-450 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-205 text-sm font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Health state */}
          <div className="flex items-center justify-between p-2 rounded-lg border border-zinc-205 dark:border-zinc-800 text-xs">
            <span>API Heartbeat:</span>
            <span className="font-semibold flex items-center gap-1.5">
              <span
                className={`inline-flex rounded-full h-2 w-2 ${isBackendOnline ? "bg-emerald-500" : "bg-red-500"}`}
              />
              {isBackendOnline ? "Connected" : "Offline"}
            </span>
            <button
              type="button"
              onClick={recheckBackendHealth}
              disabled={isCheckingHealth}
              className="text-blue-500 hover:text-blue-600 disabled:opacity-50 text-[10px] cursor-pointer"
            >
              Recheck
            </button>
          </div>

          {/* Endpoint configuration */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-550 dark:text-zinc-400">
              API Endpoint Base URL
            </label>
            <input
              type="text"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="http://localhost:8080"
              className="w-full px-2.5 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono focus:outline-hidden focus:ring-1 focus:ring-blue-500 text-zinc-800 dark:text-zinc-100"
            />
          </div>

          {/* User ID display only */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-550 dark:text-zinc-400">
              Active Cognito Email
            </label>
            <input
              type="text"
              disabled
              value={userId}
              className="w-full px-2.5 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 font-mono opacity-70 text-zinc-800 dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-855 px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 flex justify-end">
          <Button onClick={() => setIsSettingsOpen(false)} size="sm">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
