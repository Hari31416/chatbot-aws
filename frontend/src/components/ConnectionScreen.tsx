import * as React from "react";
import { Button } from "./ui/button";
import {
  Loader2,
  Server,
  Activity,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Settings,
} from "lucide-react";

interface ConnectionScreenProps {
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => void;
  functionUrl: string;
  setFunctionUrl: (url: string) => void;
  isBackendOnline: boolean | undefined;
  isFunctionOnline: boolean | undefined;
  isCheckingBackend: boolean;
  isCheckingFunction: boolean;
  onRetry: () => void;
}

export function ConnectionScreen({
  apiBaseUrl,
  setApiBaseUrl,
  functionUrl,
  setFunctionUrl,
  isBackendOnline,
  isFunctionOnline,
  isCheckingBackend,
  isCheckingFunction,
  onRetry,
}: ConnectionScreenProps) {
  const [isSettingsExpanded, setIsSettingsExpanded] = React.useState(false);
  const [tempApiUrl, setTempApiUrl] = React.useState(apiBaseUrl);
  const [tempFunctionUrl, setTempFunctionUrl] = React.useState(functionUrl);

  // Sync temp inputs when props change (e.g. from settings changed elsewhere)
  React.useEffect(() => {
    setTempApiUrl(apiBaseUrl);
  }, [apiBaseUrl]);

  React.useEffect(() => {
    setTempFunctionUrl(functionUrl);
  }, [functionUrl]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setApiBaseUrl(tempApiUrl.trim());
    setFunctionUrl(tempFunctionUrl.trim());
    // Give state a brief tick to update before calling retry
    setTimeout(() => {
      onRetry();
    }, 50);
  };

  const isChecking = isCheckingBackend || isCheckingFunction;
  const isAllOnline = isBackendOnline === true && isFunctionOnline === true;

  return (
    <div className="flex min-h-screen w-screen items-center justify-center p-4 bg-zinc-50 dark:bg-zinc-950 transition-colors duration-300 font-sans">
      <div className="w-full max-w-md bg-white/70 dark:bg-zinc-900/70 border border-zinc-200/50 dark:border-zinc-800/50 backdrop-blur-md rounded-2xl shadow-xl p-6 md:p-8 flex flex-col items-center text-center transition-all duration-300">
        {/* Pulsing server status icon */}
        <div className="relative mb-6">
          <div
            className={`absolute inset-0 rounded-full ${
              isAllOnline
                ? "bg-emerald-500/10 dark:bg-emerald-500/5"
                : isChecking
                  ? "bg-blue-500/10 dark:bg-blue-500/5 animate-pulse"
                  : "bg-red-500/10 dark:bg-red-500/5"
            }`}
          />
          <div
            className={`relative flex h-16 w-16 items-center justify-center rounded-full transition-colors duration-300 ${
              isAllOnline
                ? "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
                : isChecking
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-450"
                  : "bg-red-100 dark:bg-red-950/30 text-red-650 dark:text-red-400"
            }`}
          >
            <Server
              className={`h-8 w-8 ${isChecking ? "animate-pulse" : ""}`}
            />
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-bold font-display text-zinc-900 dark:text-zinc-50 mb-2">
          {isChecking
            ? "Connecting to Services"
            : isAllOnline
              ? "Connected Successfully"
              : "Connection Required"}
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto mb-6">
          {isChecking
            ? "Verifying backend endpoints are responsive..."
            : isAllOnline
              ? "Initializing secure database session..."
              : "Unable to reach the backend. Please check your network and configuration."}
        </p>

        {/* Status Rows */}
        <div className="w-full mb-6">
          {/* Backend API */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-950/40 mb-3 text-left">
            <div className="flex items-center gap-3 min-w-0">
              <Activity className="h-4.5 w-4.5 text-zinc-400 flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block">
                  Backend API Gateway
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 pl-2">
              {isCheckingBackend ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              ) : isBackendOnline ? (
                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] font-medium text-red-650 dark:text-red-400">
                  <XCircle className="h-3.5 w-3.5" />
                  Offline
                </span>
              )}
            </div>
          </div>

          {/* Function App */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-950/40 text-left">
            <div className="flex items-center gap-3 min-w-0">
              <Server className="h-4.5 w-4.5 text-zinc-400 flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block">
                  Streaming Function App
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 pl-2">
              {isCheckingFunction ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              ) : isFunctionOnline ? (
                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] font-medium text-red-650 dark:text-red-400">
                  <XCircle className="h-3.5 w-3.5" />
                  Offline
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="w-full space-y-2.5">
          <Button
            onClick={onRetry}
            disabled={isChecking}
            className="w-full font-medium"
            variant="default"
          >
            {isChecking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Retry Connections
              </>
            )}
          </Button>

          <Button
            onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
            className="w-full font-medium text-zinc-650 hover:text-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-100"
            variant="outline"
          >
            <Settings className="h-4 w-4" />
            {isSettingsExpanded ? "Hide Settings" : "Configure Endpoints"}
          </Button>
        </div>

        {/* Expandable Settings Form */}
        {isSettingsExpanded && (
          <form
            onSubmit={handleSave}
            className="w-full mt-5 p-4 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl bg-zinc-50/60 dark:bg-zinc-950/40 text-left space-y-3.5 animate-in slide-in-from-top-3 duration-200"
          >
            <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
              Endpoint URLs
            </h3>

            {/* API Endpoint Input */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                Backend API Gateway URL
              </label>
              <input
                type="text"
                value={tempApiUrl}
                onChange={(e) => setTempApiUrl(e.target.value)}
                placeholder="http://localhost:8080"
                className="w-full px-2.5 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-mono text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Function App Input */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                Streaming Function App URL
              </label>
              <input
                type="text"
                value={tempFunctionUrl}
                onChange={(e) => setTempFunctionUrl(e.target.value)}
                placeholder="http://localhost:8080"
                className="w-full px-2.5 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 font-mono text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Save Button */}
            <Button
              type="submit"
              size="sm"
              className="w-full mt-2 bg-zinc-800 text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-100"
            >
              Save and Recheck
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
