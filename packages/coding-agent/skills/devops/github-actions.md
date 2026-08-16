# GitHub Actions Engineering

GitHub Actions is a robust workflow automation platform. Mastering it requires understanding its execution model, caching, security, and debugging strategies.

## Workflow YAML Anatomy

*   **Triggers (`on`):** Define when the workflow runs (e.g., `push`, `pull_request`, `workflow_dispatch` for manual runs, `schedule` for cron).
*   **Jobs:** A set of steps executed on a single runner. Jobs run in parallel by default. Use `needs` to define sequential dependencies.
*   **Steps:** Individual tasks (running a shell command or using an Action).
*   **Matrix Strategies (`strategy.matrix`):** Run the same job across multiple OS/language version combinations.
*   **Concurrency (`concurrency`):** Cancel in-progress runs or queue them to avoid race conditions during deployments.

```yaml
name: CI
on:
  push:
    branches: [main]
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

## Debugging Failures

1.  **Reading Logs:** Expand the failed step in the UI. Look for exit codes (`Exit code 1`). Search for `ERR`, `FATAL`, or stack traces.
2.  **Enabling Debug Logging:** Add secrets `ACTIONS_RUNNER_DEBUG=true` and `ACTIONS_STEP_DEBUG=true` to enable verbose runner logs.
3.  **Local Reproduction:** Use `act` (https://github.com/nektos/act) to run workflows locally in Docker containers.
    ```bash
    # Run the 'test' job locally
    act -j test
    ```
4.  **SSH into Runner:** Use tools like `mxschmitt/action-tmate` or Tailscale to SSH directly into a failing runner for interactive debugging.

## Common Failure Patterns

*   **Dependency Caching Invalidation:** If a build fails mysteriously after a dependency update, the cache might be stale or corrupted. Clear caches manually via the GitHub UI or CLI (`gh actions-cache delete --all`).
*   **Secret Expiry:** Cloud credentials or API tokens expired.
*   **Runner Environment Drift:** GitHub periodically updates runner images (e.g., `ubuntu-latest`). Explicitly pin versions (e.g., `ubuntu-22.04`) or setup tools explicitly to avoid breakage.

## Advanced Patterns

*   **Reusable Workflows:** DRY up pipelines by referencing workflows from other repositories using `uses: org/repo/.github/workflows/reusable.yml@v1`.
*   **Composite Actions:** Bundle multiple steps into a single action for reuse within a repository.
*   **Dependency Caching:** Use `actions/cache` or setup actions with built-in caching (`setup-node`, `setup-go`) to speed up builds.

## Security Best Practices

*   **Least-Privilege Permissions:** Restrict the default `GITHUB_TOKEN` permissions.
    ```yaml
    permissions:
      contents: read
      id-token: write # Required for OIDC
    ```
*   **OIDC Trusted Publishing:** Do NOT store long-lived cloud credentials as secrets. Use OpenID Connect (OIDC) to request short-lived tokens dynamically from AWS/GCP/Azure.
*   **Pin Actions by SHA:** Avoid supply chain attacks by pinning action versions to a specific commit SHA, not just a tag (e.g., `uses: actions/checkout@v4` vs `uses: actions/checkout@1d96c772d19495a3b5c517cd2bc0cb401ea0529f`).

## Programmatic Querying with `gh` CLI

The `gh` CLI is powerful for scripting CI interactions.

```bash
# View recent runs
gh run list --workflow=ci.yml

# View logs for a specific run
gh run view <run-id> --log

# Re-run failed jobs
gh run rerun <run-id> --failed
```
