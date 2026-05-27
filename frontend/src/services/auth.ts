/**
 * Clerk session token bridge for non-React modules (e.g. api.ts).
 * Register the getter from a component that has access to useAuth().
 */
let tokenGetter: (() => Promise<string | null>) | null = null;

export function setClerkTokenGetter(
  getter: () => Promise<string | null>,
): void {
  tokenGetter = getter;
}

export async function getCurrentSessionToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  return tokenGetter();
}
