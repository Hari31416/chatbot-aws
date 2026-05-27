import * as React from "react";
import { useAuth, useUser } from "@clerk/react";
import { setClerkTokenGetter } from "../services/auth";

interface ClerkAuthSyncProps {
  onAuthChange: (signedIn: boolean, displayLabel: string) => void;
}

/**
 * Registers Clerk's getToken with api.ts and syncs login state to App.
 */
export function ClerkAuthSync({ onAuthChange }: ClerkAuthSyncProps) {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const { user } = useUser();

  React.useEffect(() => {
    setClerkTokenGetter(async () => {
      try {
        return await getToken();
      } catch {
        return null;
      }
    });
  }, [getToken]);

  React.useEffect(() => {
    if (!isLoaded) return;
    const displayLabel =
      user?.primaryEmailAddress?.emailAddress ||
      user?.username ||
      user?.id ||
      "Guest";
    onAuthChange(Boolean(isSignedIn), displayLabel);
  }, [isLoaded, isSignedIn, user, onAuthChange]);

  return null;
}
