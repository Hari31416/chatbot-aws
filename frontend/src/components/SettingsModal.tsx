import * as React from "react";
import { Button } from "./ui/button";

interface SettingsModalProps {
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isBackendOnline: boolean | undefined;
  recheckBackendHealth: () => void;
  isCheckingHealth: boolean;
  isFunctionOnline: boolean | undefined;
  recheckFunctionHealth: () => void;
  isCheckingFunction: boolean;
  userId: string;
}

export function SettingsModal({
  isSettingsOpen,
  setIsSettingsOpen,
  isBackendOnline,
  recheckBackendHealth,
  isCheckingHealth,
  isFunctionOnline,
  recheckFunctionHealth,
  isCheckingFunction,
  userId,
}: SettingsModalProps) {
  const [isEmailRevealed, setIsEmailRevealed] = React.useState(false);

  const garbleEmail = (email: string): string => {
    if (!email || email === "Guest") return email;
    if (!email.includes("@")) return email;
    const [local, domain] = email.split("@");
    if (local.length <= 3) {
      return `${local.charAt(0)}${"•".repeat(local.length - 1)}@${domain}`;
    }
    return `${local.slice(0, 2)}${"•".repeat(local.length - 4)}${local.slice(-2)}@${domain}`;
  };
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
          {/* Health status checks */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-550 dark:text-zinc-400">
              Service Status Checks
            </label>
            <div className="space-y-2 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 bg-zinc-50/50 dark:bg-zinc-950/20 text-xs">
              {/* Backend API status */}
              <div className="flex items-center justify-between">
                <span>Backend API:</span>
                <div className="flex items-center gap-2">
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
                    className="text-blue-500 hover:text-blue-600 disabled:opacity-50 text-[10px] cursor-pointer font-medium"
                  >
                    {isCheckingHealth ? "..." : "Recheck"}
                  </button>
                </div>
              </div>

              {/* Function App status */}
              <div className="flex items-center justify-between border-t border-zinc-200/50 dark:border-zinc-800/50 pt-2 mt-2">
                <span>Function App:</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold flex items-center gap-1.5">
                    <span
                      className={`inline-flex rounded-full h-2 w-2 ${isFunctionOnline ? "bg-emerald-500" : "bg-red-500"}`}
                    />
                    {isFunctionOnline ? "Connected" : "Offline"}
                  </span>
                  <button
                    type="button"
                    onClick={recheckFunctionHealth}
                    disabled={isCheckingFunction}
                    className="text-blue-500 hover:text-blue-600 disabled:opacity-50 text-[10px] cursor-pointer font-medium"
                  >
                    {isCheckingFunction ? "..." : "Recheck"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          {/* User ID display only */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-550 dark:text-zinc-400">
              Active User Email
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                disabled
                value={isEmailRevealed ? userId : garbleEmail(userId)}
                className="w-full pl-2.5 pr-8 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 font-mono opacity-70 text-zinc-800 dark:text-zinc-100"
              />
              {userId !== "Guest" && (
                <button
                  type="button"
                  onClick={() => setIsEmailRevealed(!isEmailRevealed)}
                  className="absolute right-2 text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-300 focus:outline-hidden cursor-pointer"
                  title={isEmailRevealed ? "Hide email" : "Show email"}
                >
                  {isEmailRevealed ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-3.5 h-3.5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.824 7.824 3 3m-3-3-3.867-3.867m0 0a3 3 0 1 1-4.243-4.243m4.242 4.242L9.88 9.88"
                      />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-3.5 h-3.5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                      />
                    </svg>
                  )}
                </button>
              )}
            </div>
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
