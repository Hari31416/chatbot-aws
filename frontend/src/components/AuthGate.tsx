import * as React from "react";

interface AuthGateProps {
  authMode: "LOGIN" | "SIGNUP" | "VERIFY";
  setAuthMode: (mode: "LOGIN" | "SIGNUP" | "VERIFY") => void;
  authEmail: string;
  setAuthEmail: (email: string) => void;
  authPassword: string;
  setAuthPassword: (password: string) => void;
  authCode: string;
  setAuthCode: (code: string) => void;
  authLoading: boolean;
  handleAuthSubmit: (e: React.FormEvent) => void;
}

export function AuthGate({
  authMode,
  setAuthMode,
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  authCode,
  setAuthCode,
  authLoading,
  handleAuthSubmit,
}: AuthGateProps) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 font-sans text-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 animate-in zoom-in-95 duration-150">
        <div className="text-center space-y-1 mb-5">
          <h1 className="text-lg font-bold tracking-tight text-blue-600 dark:text-blue-500">
            Chatbot
          </h1>
          <p className="text-xs text-zinc-450">
            {authMode === "LOGIN" && "Sign in to access your chatbot"}
            {authMode === "SIGNUP" && "Create a free user account"}
            {authMode === "VERIFY" &&
              "Enter the confirmation code sent to your email"}
          </p>
        </div>

        <form onSubmit={handleAuthSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-zinc-500 block mb-1">
              EMAIL ADDRESS
            </label>
            <input
              type="email"
              required
              disabled={authMode === "VERIFY" || authLoading}
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@domain.com"
              className="w-full px-3 py-2 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {authMode !== "VERIFY" && (
            <div>
              <label className="text-[11px] font-semibold text-zinc-500 block mb-1">
                PASSWORD
              </label>
              <input
                type="password"
                required
                disabled={authLoading}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 text-xs rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          {authMode === "VERIFY" && (
            <div>
              <label className="text-[11px] font-semibold text-zinc-500 block mb-1">
                CONFIRMATION CODE
              </label>
              <input
                type="text"
                required
                disabled={authLoading}
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                placeholder="123456"
                maxLength={6}
                className="w-full px-3 py-2 text-xs text-center tracking-widest font-mono rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={authLoading}
            className="w-full py-2.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition duration-150 disabled:opacity-50"
          >
            {authLoading ? (
              "Processing..."
            ) : (
              <>
                {authMode === "LOGIN" && "Sign In"}
                {authMode === "SIGNUP" && "Sign Up"}
                {authMode === "VERIFY" && "Verify Account"}
              </>
            )}
          </button>
        </form>

        {/* Mode Switchers */}
        <div className="mt-4 pt-4 border-t border-zinc-150 dark:border-zinc-850 text-center text-xs text-zinc-500">
          {authMode === "LOGIN" && (
            <p>
              Don't have an account?{" "}
              <button
                onClick={() => setAuthMode("SIGNUP")}
                className="text-blue-500 font-semibold hover:underline"
              >
                Sign Up
              </button>
            </p>
          )}
          {authMode === "SIGNUP" && (
            <p>
              Already have an account?{" "}
              <button
                onClick={() => setAuthMode("LOGIN")}
                className="text-blue-500 font-semibold hover:underline"
              >
                Sign In
              </button>
            </p>
          )}
          {authMode === "VERIFY" && (
            <p>
              Did not receive code?{" "}
              <button
                onClick={() => setAuthMode("LOGIN")}
                className="text-blue-500 font-semibold hover:underline"
              >
                Back to Sign In
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
