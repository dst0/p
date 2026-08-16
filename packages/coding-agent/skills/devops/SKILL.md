---
name: devops
description: CI/CD pipeline debugging, container engineering, deployment strategies, and production observability. Use when diagnosing build failures, optimizing pipelines, containerizing applications, or setting up monitoring.
---

# DevOps and CI/CD Engineering

This discipline covers the end-to-end lifecycle of software delivery, from code commit to production operations. It focuses on automation, reliability, velocity, and observability.

## Pipeline Anatomy

A typical modern CI/CD pipeline consists of:
1.  **Continuous Integration (CI):**
    *   **Linting & Formatting:** Enforcing code style (e.g., Prettier, ESLint, `gofmt`).
    *   **Unit & Integration Tests:** Validating application logic.
    *   **Static Analysis (SAST):** Scanning for security vulnerabilities and code quality issues (e.g., SonarQube, CodeQL).
    *   **Build:** Compiling code and packaging artifacts (e.g., JARs, binaries, Docker images).
2.  **Continuous Delivery/Deployment (CD):**
    *   **Artifact Publishing:** Pushing images to a registry (e.g., ECR, Docker Hub) or packages to a repository (e.g., npm, Maven Central).
    *   **Provisioning:** Creating infrastructure (Terraform, Pulumi).
    *   **Deployment:** Updating environments (Staging -> Production) via progressive rollout strategies.
    *   **Post-Deployment Verification:** Running smoke tests against live endpoints.

## Failure Taxonomy

Build and deployment pipelines fail for predictable reasons. Categorizing failures speeds up resolution:
1.  **Environment & Dependency Failures:** Missing packages, network timeouts to package registries, mismatched Node/Python/Go versions, cached state drift.
2.  **State & Data Issues:** Flaky tests failing due to race conditions or shared database state, schema migration conflicts.
3.  **Authentication & Authorization:** Expired secrets, rotated API keys, missing IAM permissions for cloud resources, untrusted OIDC tokens.
4.  **Resource Constraints:** Out-of-memory (OOM) kills on runner nodes, disk space exhaustion, CPU throttling leading to timeouts.
5.  **Infrastructure Drifts:** Discrepancies between expected infrastructure state (Terraform) and actual cloud provider state.

## Systematic Debugging Approach

1.  **Isolate the Failure:** Identify the exact step, job, and command that failed. Read logs from the bottom up.
2.  **Reproduce Locally:** Avoid "commit-and-pray" debugging. Use tools like Docker or `act` (for GitHub Actions) to simulate the runner environment locally.
3.  **Verify Environment:** Check runner OS, tool versions, environment variables, and injected secrets. Are they identical to local development?
4.  **Isolate State:** Disable caches. Often, corrupted dependency caches (e.g., `node_modules`, `.m2`) cause inexplicable failures.
5.  **Inspect Infrastructure:** For CD failures, check cloud provider metrics and audit logs (AWS CloudTrail, GCP Cloud Audit Logs) to identify permission or quota issues.
