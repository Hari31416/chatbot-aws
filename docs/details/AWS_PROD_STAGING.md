# Managing Production and Staging Environments in AWS Serverless

To maintain high availability and enable safe feature iteration, this document outlines the three primary strategies for managing and separating **Production** and **Staging** environments in our serverless AWS chatbot architecture.

---

## Architecture Environment Matrix

Each environment should run isolated serverless resource sets:

| Component              | Staging Environment                  | Production Environment            |
| :--------------------- | :----------------------------------- | :-------------------------------- |
| **AWS Stack Name**     | `chat-staging`                       | `chat` (or `chat-prod`)           |
| **Database Table**     | `chatbot-table-staging`              | `chatbot-table-prod`              |
| **S3 Uploads Bucket**  | `chatbot-uploads-<account>-staging`  | `chatbot-uploads-<account>-prod`  |
| **S3 Frontend Bucket** | `chatbot-frontend-<account>-staging` | `chatbot-frontend-<account>-prod` |
| **Cognito User Pool**  | `chatbot-users-staging`              | `chatbot-users-prod`              |
| **Invocation Route**   | Lambda Function URL (Streaming)      | Lambda Function URL (Streaming)   |

---

## Three Strategies for Environment Management

### Strategy 1: Multi-Environment via SAM Profile Configurations (Recommended)

This approach deploys multiple stacks into a **single AWS account** by using independent configurations under separate profile blocks in [samconfig.toml](file:///Users/hari/Desktop/sandbox/chatbot-aws/samconfig.toml).

#### How it works:

SAM reads different parameter files using the `--config-env` CLI argument. Both stacks deploy cleanly alongside each other in the same region without overlapping because every resource name includes the `${Environment}` suffix.

#### Implementation in `samconfig.toml`:

```toml
# Default/Production environment parameters
[default.deploy.parameters]
stack_name = "chat"
parameter_overrides = "Environment=\"prod\" LogLevel=\"INFO\""

# Staging environment parameters
[staging.deploy.parameters]
stack_name = "chat-staging"
parameter_overrides = "Environment=\"staging\" LogLevel=\"DEBUG\""
```

#### Deployment commands:

```bash
# 1. Deploy Staging
sam build --use-container
sam deploy --config-env staging
./deploy-frontend.sh chat-staging

# 2. Deploy Production
sam build --use-container
sam deploy --config-env default
./deploy-frontend.sh chat
```

> [!TIP]
> **Pros**: Extremely fast set up, zero overhead, single AWS bill, easy comparison of stacks side-by-side.
>
> **Cons**: AWS account limits (like concurrent executions or DynamoDB read/write capacity limits) are shared. A spike in staging load could throttle production.

---

### Strategy 2: Multi-Account Isolation (Enterprise Best Practice)

For absolute safety, staging and production are deployed into **completely different AWS accounts** (e.g., managed via AWS Organizations or AWS Control Tower).

#### How it works:

1. You maintain two separate AWS CLI profiles locally (e.g., `[profile staging]` and `[profile prod]` in `~/.aws/config`).
2. Before deploying, you export the target `AWS_PROFILE` or pass the `--profile` parameter.

#### Deployment commands:

```bash
# 1. Deploy Staging Account
export AWS_PROFILE=staging
sam build --use-container
sam deploy --config-env default
./deploy-frontend.sh chat

# 2. Deploy Production Account
export AWS_PROFILE=prod
sam build --use-container
sam deploy --config-env default
./deploy-frontend.sh chat
```

> [!IMPORTANT]
> **Pros**: 100% security boundary, isolated bills, separate resource quotas, zero chance of staging load impacting production (zero blast radius).
>
> **Cons**: Requires managing multiple credentials, multiple AWS bills, and setting up cross-account access rules if sharing SSM parameters.

---

### Strategy 3: Branch-Driven CI/CD Pipelines (Automated DevOps)

Instead of running manual scripts from local terminals, developers leverage automated pipelines (e.g., **GitHub Actions**, **GitLab CI**, or **AWS CodePipeline**) triggered on git events.

#### How it works:

- Pull Requests or merges into the `develop` branch trigger staging builds.
- Merges into the `main` or `release` branch trigger production builds.
- AWS credentials are securely saved as repository Secrets.

#### Example GitHub Actions Workflow (`.github/workflows/deploy.yml`):

```yaml
name: Serverless Deployment Pipeline
on:
  push:
    branches:
      - main
      - develop

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-south-1

      - name: Set Environment variables
        run: |
          if [ "${{ github.ref_name }}" = "main" ]; then
            echo "ENV_NAME=default" >> $GITHUB_ENV
            echo "STACK_NAME=chat" >> $GITHUB_ENV
          else
            echo "ENV_NAME=staging" >> $GITHUB_ENV
            echo "STACK_NAME=chat-staging" >> $GITHUB_ENV
          fi

      - name: Build SAM resources
        run: |
          cd backend
          pip install uv
          uv export --format requirements-txt --no-hashes --no-emit-project -o requirements.txt
          cd ..
          sam build --use-container

      - name: Deploy Backend
        run: sam deploy --config-env ${{ env.ENV_NAME }} --no-confirm-changeset

      - name: Deploy Frontend
        run: ./deploy-frontend.sh ${{ env.STACK_NAME }}
```

> [!TIP]
> **Pros**: Fully automated, audited deployment logs, peer-reviewed changes (pull request approvals before prod push), eliminates local environment drift.
>
> **Cons**: Requires pipeline setup time and maintenance of CI runners/secrets.
