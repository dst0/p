# Production Observability

Observability is the ability to understand a system's internal state based on its external outputs (telemetry). The three pillars are Logs, Metrics, and Traces.

## 1. Structured Logging

Traditional plain-text logs are difficult to parse and query. Use structured logging (JSON) to allow log aggregators (Elasticsearch, Datadog, Splunk) to index fields.

*   **Include Context:** Always log `tenant_id`, `user_id`, `request_id`, and `environment`.
*   **Correlation IDs:** Generate a unique UUID at the edge (API Gateway/Load Balancer) and pass it through all downstream microservices via HTTP headers (e.g., `X-Correlation-ID`). Include this ID in every log line to trace a request's lifecycle.
*   **Log Levels:**
    *   `DEBUG`: Verbose information for developers (disabled in prod).
    *   `INFO`: Normal business events (user logged in, order placed).
    *   `WARN`: Handled errors, retries, deprecated API usage.
    *   `ERROR`: Unhandled exceptions, failed operations requiring attention.

## 2. Metrics

Metrics provide aggregate data over time. Use tools like Prometheus or StatsD.

*   **Counters:** Monotonically increasing values (e.g., total requests, errors).
*   **Gauges:** Point-in-time values that can go up or down (e.g., active connections, memory usage, queue depth).
*   **Histograms/Summaries:** Statistical distributions (e.g., request latency, payload sizes). Use percentiles (p95, p99) rather than averages, which hide outliers.

**The RED Method for Services:**
*   **R**ate: Number of requests per second.
*   **E**rrors: Number of failing requests.
*   **D**uration: Time taken to serve requests.

## 3. Distributed Tracing

Tracing tracks a request's path as it flows through a distributed system. OpenTelemetry is the industry standard.

*   **Spans:** Represent a single unit of work (e.g., an HTTP request, a database query).
*   **Trace Context Propagation:** Passing trace IDs and parent span IDs between services.

## Alerting Strategies

Alerts should be actionable. Avoid alert fatigue.

*   **Symptom vs. Cause Alerts:** Alert on symptoms (e.g., "High Error Rate", "High Latency") that impact users, rather than underlying causes (e.g., "CPU at 90%", "Database connection pool saturated"). A high CPU might not affect users, but high latency definitely does.
*   **Service Level Objectives (SLOs):** Define acceptable thresholds for reliability (e.g., 99.9% of requests succeed in under 200ms). Alert when the error budget is burning too fast.

## Incident Response Workflow

1.  **Acknowledge:** Confirm someone is looking at the alert.
2.  **Triage:** Assess impact (severity) and scope.
3.  **Mitigate:** Stop the bleeding. Roll back a deployment, scale up resources, or toggle a feature flag. Do not try to write a permanent fix during an outage.
4.  **Resolve:** Implement a permanent fix.
5.  **Post-Mortem:** Conduct a blameless review to identify root causes and action items to prevent recurrence.
