// Dynamic configurations loaded from Vite environments
const region = import.meta.env.VITE_AWS_REGION || "ap-south-1";
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID || "";

const COGNITO_URL = `https://cognito-idp.${region}.amazonaws.com/`;

export interface AuthSession {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  email: string;
}

/**
 * Executes a direct target call to Cognito Identity Provider REST endpoint
 */
async function callCognito(
  target: string,
  payload: Record<string, any>,
): Promise<any> {
  const response = await fetch(COGNITO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      data.message || `Cognito auth failed with status ${response.status}`,
    );
  }
  return data;
}

/**
 * Register a new user using their Email and Password
 */
export async function signUpUser(
  email: string,
  password: string,
): Promise<string> {
  if (!clientId) {
    throw new Error("VITE_COGNITO_CLIENT_ID environment variable is missing.");
  }

  const data = await callCognito("SignUp", {
    ClientId: clientId,
    Username: email,
    Password: password,
    UserAttributes: [
      {
        Name: "email",
        Value: email,
      },
    ],
  });

  return data.UserSub;
}

/**
 * Confirm user signup using the verification code sent to their email
 */
export async function confirmSignUpUser(
  email: string,
  code: string,
): Promise<boolean> {
  if (!clientId) {
    throw new Error("VITE_COGNITO_CLIENT_ID environment variable is missing.");
  }

  await callCognito("ConfirmSignUp", {
    ClientId: clientId,
    Username: email,
    ConfirmationCode: code,
  });

  return true;
}

/**
 * Authenticate user credentials and retrieve JWT tokens
 */
export async function signInUser(
  email: string,
  password: string,
): Promise<AuthSession> {
  if (!clientId) {
    throw new Error("VITE_COGNITO_CLIENT_ID environment variable is missing.");
  }

  const data = await callCognito("InitiateAuth", {
    ClientId: clientId,
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });

  const authResult = data.AuthenticationResult;
  if (!authResult) {
    throw new Error(
      "InitiateAuth did not return credentials. Check password complexity.",
    );
  }

  const session: AuthSession = {
    accessToken: authResult.AccessToken,
    idToken: authResult.IdToken,
    refreshToken: authResult.RefreshToken,
    email: email,
  };

  // Save session details to local storage
  localStorage.setItem("auth_id_token", session.idToken);
  localStorage.setItem("auth_access_token", session.accessToken);
  localStorage.setItem("auth_refresh_token", session.refreshToken);
  localStorage.setItem("auth_user_email", session.email);

  return session;
}

/**
 * Terminate session and clear credentials
 */
export function signOutUser(): void {
  localStorage.removeItem("auth_id_token");
  localStorage.removeItem("auth_access_token");
  localStorage.removeItem("auth_refresh_token");
  localStorage.removeItem("auth_user_email");
}

/**
 * Checks if a valid Cognito token session exists
 */
export function isUserLoggedIn(): boolean {
  return !!localStorage.getItem("auth_id_token");
}

/**
 * Returns active user email address
 */
export function getCurrentUserEmail(): string {
  return localStorage.getItem("auth_user_email") || "Guest";
}

/**
 * Returns active JWT ID token for API Gateway authorization headers
 */
export function getCurrentSessionToken(): string | null {
  return localStorage.getItem("auth_id_token");
}
