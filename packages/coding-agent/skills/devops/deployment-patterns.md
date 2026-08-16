# Deployment Strategies

Modern deployments decouple the act of deploying code from releasing a feature to users, minimizing risk and maximizing feedback.

## Advanced Rollout Strategies

*   **Blue-Green Deployment:** Maintain two identical environments. Route traffic to the "blue" environment. Deploy new code to the "green" environment. Once verified, switch the router to point to "green". Offers fast, safe rollbacks.
*   **Canary Release:** Deploy new code to a small subset of servers (e.g., 5% of traffic). Monitor error rates and latency. If stable, gradually increase traffic to 100%. If anomalies are detected, automatically roll back.
*   **Rolling Updates:** Gradually replace instances running the old version with instances running the new version. Standard in Kubernetes (`Strategy: RollingUpdate`).

## Feature Flags (Progressive Delivery)

Feature flags separate code deployment from feature release. Deploy dormant code, then flip a flag in a configuration system (e.g., LaunchDarkly, Unleash) to enable the feature for specific users (e.g., internal staff, beta testers) before a general release. Allows instant rollbacks without redeploying code.

## Zero-Downtime Database Migrations

Deployments must not break the database. Migrations must be backward and forward compatible.

1.  **Add, Don't Alter/Drop:** Instead of renaming a column, add a new column. Update the application to write to both, read from the new. In a later deployment, backfill data and drop the old column.
2.  **Expand and Contract Pattern:**
    *   *Phase 1 (Expand):* Add new schema elements (tables, columns).
    *   *Phase 2 (Migrate):* Deploy code that supports both old and new schemas.
    *   *Phase 3 (Contract):* Deploy code that only uses the new schema. Remove old schema elements.

## Rollback Procedures

*   **Fast Rollbacks:** A rollback should ideally involve reverting an image tag in a deployment manifest or flipping a feature flag, not rebuilding code.
*   **Blast Radius Limitation:** Use canary deployments and regional rollouts (e.g., deploy to `us-east-1` before `eu-west-1`) to limit the impact of a bad deployment.

## Infrastructure as Code (IaC)

Manage infrastructure declaratively using tools like Terraform or Pulumi.

*   **Terraform Basics:** Define resources in HCL (HashiCorp Configuration Language). Use state files (stored remotely, e.g., in an S3 bucket with DynamoDB locking) to track existing infrastructure.
    ```hcl
    resource "aws_instance" "web" {
      ami           = "ami-0c55b159cbfafe1f0"
      instance_type = "t2.micro"
    }
    ```
*   **Immutable Infrastructure:** Never SSH into servers to configure them. If a server is misbehaving, destroy it and let the orchestrator replace it with a fresh instance from the base image.
