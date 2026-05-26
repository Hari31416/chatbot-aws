import * as React from "react";

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  type: "success" | "error" | "info" | "warning";
}

interface ToastContextType {
  toasts: ToastMessage[];
  toast: (message: Omit<ToastMessage, "id">) => void;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextType | undefined>(
  undefined,
);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);

  const toast = React.useCallback((message: Omit<ToastMessage, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...message, id }]);
    setTimeout(() => {
      dismiss(id);
    }, 4000);
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full p-4 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full flex-col gap-1 rounded-xl p-4 shadow-lg border transition-all duration-300 transform translate-y-0 animate-in slide-in-from-bottom-5 fade-in-50 ${
              t.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/90 dark:border-emerald-800 dark:text-emerald-50"
                : t.type === "error"
                  ? "bg-red-50 border-red-200 text-red-950 dark:bg-red-950/90 dark:border-red-900 dark:text-red-50"
                  : t.type === "warning"
                    ? "bg-amber-50 border-amber-200 text-amber-950 dark:bg-amber-950/90 dark:border-amber-900 dark:text-amber-50"
                    : "bg-zinc-50 border-zinc-200 text-zinc-900 dark:bg-zinc-900/95 dark:border-zinc-800 dark:text-zinc-50"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{t.title}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 text-xs font-bold px-1"
              >
                ✕
              </button>
            </div>
            {t.description && (
              <p className="text-xs opacity-90 leading-relaxed">
                {t.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
