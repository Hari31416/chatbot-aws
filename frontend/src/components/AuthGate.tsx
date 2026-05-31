import * as React from "react";
import { SignIn, SignUp } from "@clerk/react";
import { useTheme } from "@/components/theme-provider";

type ClerkAuthPath = "sign-in" | "sign-up";

function readAuthPathFromHash(): ClerkAuthPath {
  const hash = window.location.hash.toLowerCase();
  if (hash.includes("sign-up") || hash.includes("signup")) {
    return "sign-up";
  }
  return "sign-in";
}

function useClerkAuthPath(): ClerkAuthPath {
  const [path, setPath] = React.useState<ClerkAuthPath>(readAuthPathFromHash);

  React.useEffect(() => {
    const sync = () => setPath(readAuthPathFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return path;
}

export function AuthGate() {
  const authPath = useClerkAuthPath();
  const isSignUp = authPath === "sign-up";
  const { theme } = useTheme();

  // Determine if dark mode is active (resolving 'system' option)
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Appearance customization matching application design tokens
  const appearance = isDark
    ? {
        variables: {
          colorPrimary: "#2563eb", // Blue-600
          colorBackground: "#09090b", // Zinc-950
          colorInputBackground: "#18181b", // Zinc-900
          colorInputText: "#f4f4f5", // Zinc-100
          colorText: "#f4f4f5", // Zinc-100
          colorTextSecondary: "#a1a1aa", // Zinc-400
          colorTextOnPrimaryBackground: "#ffffff",
        },
        elements: {
          cardBox: "shadow-none border border-zinc-800 rounded-xl",
          card: "bg-zinc-950 border border-zinc-800",
          headerTitle: "text-zinc-100",
          headerSubtitle: "text-zinc-400",
          socialButtonsBlockButton:
            "bg-zinc-900 border-zinc-800 text-zinc-100 hover:bg-zinc-800",
          formButtonPrimary:
            "bg-zinc-100 text-zinc-950 hover:bg-zinc-200 border-none",
          footerActionText: "text-zinc-400",
          footerActionLink: "text-blue-500 hover:text-blue-400",
          dividerLine: "bg-zinc-800",
          dividerText: "text-zinc-400",
          formFieldLabel: "text-zinc-300",
          formFieldInput:
            "bg-zinc-900 border-zinc-800 text-zinc-100 focus:border-blue-500 focus:ring-blue-500",
          identityPreviewText: "text-zinc-300",
          identityPreviewEditButtonIcon: "text-zinc-400",
          footer: "bg-zinc-950 border-t border-zinc-800 text-zinc-400",
        },
      }
    : {
        variables: {
          colorPrimary: "#2563eb", // Blue-600
        },
      };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 font-sans text-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-md px-4">
        <div className="text-center space-y-1 mb-6">
          <h1 className="text-lg font-bold tracking-tight text-blue-600 dark:text-blue-500">
            Chatbot
          </h1>
          <p className="text-xs text-zinc-450">
            {isSignUp
              ? "Create an account to get started"
              : "Sign in to access your chatbot"}
          </p>
        </div>

        {isSignUp ? (
          <SignUp
            routing="hash"
            signInUrl="#/sign-in"
            fallbackRedirectUrl="/"
            forceRedirectUrl="/"
            appearance={appearance}
          />
        ) : (
          <SignIn
            routing="hash"
            signUpUrl="#/sign-up"
            fallbackRedirectUrl="/"
            forceRedirectUrl="/"
            appearance={appearance}
          />
        )}
      </div>
    </div>
  );
}
