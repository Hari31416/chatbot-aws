# Chatbot AWS — Cognito Authentication Architecture

This document details the serverless authentication system built using **AWS Cognito User Pools** (Option A). The architecture leverages edge-level API Gateway validation to optimize cost and security, coupled with a zero-dependency React login gate.

---

## 1. Authentication Architecture

```
User (Browser)  ───►  Cognito Identity Provider (REST APIs)
     │                     │
     │ Token               ▼ Returns ID Token (JWT)
     ▼
API Gateway (Edge) ───►  Verifies JWT Signature & Expiry (Cognito Authorizer)
     │
     ▼ Verified claims (username / sub)
FastAPI Backend (Lambda) ───► Resolves User Profile & History in DynamoDB
```

---

## 2. Infrastructure Configuration (`template.yaml`)

We provision Cognito resources entirely via AWS SAM (CloudFormation):

### User Pool & Client

- **`ChatbotUserPool`**: Manages the user directory. It is configured for **email-based registration** (users log in using their email addresses as their usernames). Password policies require a minimum length of 8 characters.
- **`ChatbotUserPoolClient`**: Generates client app IDs for the React client. `GenerateSecret` is set to `false` because browser-based SPAs cannot securely store secret keys without exposing them to the user.

### API Gateway Integration (HTTP API Authorizer)

- We define a **`CognitoAuthorizer`** on `ChatbotHttpApi`.
- The authorizer uses the **`Authorization`** header (prefixed with `Bearer `) as the token source.
- It checks the JWT signature against the Cognito User Pool issuer URL and validates that the token audience matches our Client ID.
- **Endpoint Scopes**:
  - `GET, POST, PUT, DELETE /{proxy+}`: **Secured** by inheriting `DefaultAuthorizer: CognitoAuthorizer`.
  - `OPTIONS /{proxy+}` (Preflight): **Bypassed / Public**. By not declaring an explicit `OPTIONS` route under the authorizer, API Gateway automatically responds to browser CORS preflight requests using the configured `CorsConfiguration`, allowing headers like `Authorization` without throwing a 401/403 CORS block.
  - `GET /health`: **Public** via `Authorizer: NONE` (enables frontend health heartbeat checks without authentication).

---

## 3. Zero-Dependency Frontend Authentication

To avoid adding massive client packages (like AWS Amplify or full AWS SDKs) that increase bundle sizes and cause Vite build warnings, we communicate with the Cognito Identity Provider directly using standard browser `fetch` calls.

We execute target operations against `https://cognito-idp.<region>.amazonaws.com/` using the `"Content-Type": "application/x-amz-json-1.1"` header:

### Supported Auth Flows

1.  **Sign Up (`AWSCognitoIdentityProviderService.SignUp`)**:
    - Creates a new unverified user profile with their email and password.
2.  **Confirm Sign Up (`AWSCognitoIdentityProviderService.ConfirmSignUp`)**:
    - Verifies their email using the 6-digit confirmation code Cognito automatically sends to their address upon sign-up.
3.  **Log In (`InitiateAuth` - `USER_PASSWORD_AUTH`)**:
    - Validates user credentials and returns three JWTs:
      - `AccessToken`: Standard access credentials.
      - `IdToken` (Used for Auth): Contains email and user attributes.
      - `RefreshToken`: Extended session management.

_The JWT `IdToken` is saved locally in `localStorage` under `auth_id_token` and automatically attached as `Authorization: Bearer <idToken>` for all chat operations._

---

## 4. Context-Aware Backend claims Parsing

Once API Gateway validates the JWT, it passes the decrypted token details inside the Lambda request event context. Our FastAPI backend resolves the active user ID using a custom dependency.

### `get_current_user_id(request: Request)`

Defined in [dependencies.py](file:///Users/hari/Desktop/sandbox/chatbot-aws/backend/app/dependencies.py), this dependency parses and extracts the authenticated identity:

1.  **Lambda Environment**:
    It parses the event scope:
    `request.scope["aws.event"]["requestContext"]["authorizer"]["jwt"]["claims"]["username"]`
    This returns the verified Cognito user sub or username, which we use to query conversation histories in DynamoDB.
2.  **Local Development Fallback**:
    If the `aws.event` scope is not present (running uvicorn locally offline), it checks the `Authorization` header or `X-User-ID` custom header, enabling complete local debugging without needing active internet connection or cloud deployments.

---

## 5. Local Dev & Profile Customization

When testing locally:

- Auth is automatically bypassed to keep offline local development simple.
- You can open the **Settings drawer** in the UI and enter any custom username (e.g., `tester@domain.com`).
- This will automatically override local headers and map DynamoDB messages under that custom tester ID!

---

## 6. Creating Shared / Dummy User Credentials

For testing, demoing, or sharing access with external reviewers, you can create pre-confirmed "dummy" or "guest" user credentials.

By default, users created via Cognito's administrative APIs start in a `FORCE_CHANGE_PASSWORD` state, which forces the user to reset their credentials on their first login. To create a seamless experience for external reviewers, you must set their password permanently using the AWS CLI or AWS Console.

### Using the AWS CLI

Run the following two commands to provision a pre-confirmed user with a permanent password. Replace `<UserPoolId>` with your actual Cognito User Pool ID (e.g., `ap-south-1_AjsNQ0nGB`):

1. **Create the guest user and mark their email as verified:**

   ```bash
   aws cognito-idp admin-create-user \
       --user-pool-id <UserPoolId> \
       --username guest@example.com \
       --user-attributes Name=email,Value=guest@example.com Name=email_verified,Value=true \
       --message-action SUPPRESS
   ```

   _(The `--message-action SUPPRESS` flag prevents Cognito from trying to send an automated invitation email to a dummy email address)._

2. **Set a permanent password (changes status from `FORCE_CHANGE_PASSWORD` to `CONFIRMED`):**
   ```bash
   aws cognito-idp admin-set-user-password \
       --user-pool-id <UserPoolId> \
       --username guest@example.com \
       --password HelloGuest123 \
       --permanent
   ```
   _(Make sure the password is at least 8 characters long to comply with the user pool security policy)._

### Using the AWS Console (UI)

1. Navigate to the **AWS Cognito Console** and select your User Pool (e.g., `chatbot-users-prod`).
2. Go to **Users** -> **Create user**.
3. Fill out the details:
   - Select **Don't send an invitation message**.
   - Input the **Email address** (e.g., `guest@example.com`).
   - Check **Mark email address as verified**.
   - Provide a temporary password and click **Create user**.
4. Once created, you must still run the CLI step 2 (`admin-set-user-password` with `--permanent`) to bypass the forced password reset screen during their first login.
