# Container Engineering

Mastering containerization involves optimizing image size, security, build speed, and runtime stability.

## Multi-Stage Builds

Use multi-stage builds to compile code in a bulky environment (SDKs, build tools) but package the final artifact in a minimal base image (Alpine, Distroless). This reduces attack surface and deployment time.

```dockerfile
# Stage 1: Build
FROM golang:1.21 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o myapp .

# Stage 2: Final minimal image
FROM gcr.io/distroless/static-debian11
COPY --from=builder /app/myapp /myapp
USER nonroot:nonroot
ENTRYPOINT ["/myapp"]
```

## Layer Caching Optimization

Docker caches layers based on instructions and files. Order instructions from least frequently changed (e.g., OS packages) to most frequently changed (e.g., application code) to maximize cache hits.

1. Install OS dependencies.
2. Copy package manifests (`package.json`, `requirements.txt`).
3. Install application dependencies.
4. Copy source code.

## Security Scanning

Integrate container scanning into the CI pipeline to detect CVEs before deployment.
*   **Trivy:** `trivy image myapp:latest`
*   **Snyk:** `snyk container test myapp:latest`

## Health Checks & Signal Handling

Containers must integrate with orchestrators (like Kubernetes) for lifecycle management.

*   **Health Checks:** Define endpoints (e.g., `/healthz`) that return 200 OK only when the application is truly ready to serve traffic (database connected, caches primed).
*   **Graceful Shutdown:** Applications must listen for `SIGTERM` signals. Upon receiving `SIGTERM`, stop accepting new requests, finish processing in-flight requests, close database connections, and exit cleanly.

```javascript
// Node.js example
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    db.close();
  });
});
```

## Debugging Running Containers

*   **Logs:** `docker logs -f <container_id>` or `kubectl logs -f <pod_name>`
*   **Exec:** Open a shell inside the container: `docker exec -it <container_id> /bin/sh` (Note: Minimal images like Distroless do not have shells; use ephemeral debug containers in Kubernetes).
*   **Inspect:** View container metadata, networking, and mounts: `docker inspect <container_id>`

## Compose vs Kubernetes

*   **Docker Compose:** Excellent for local development, defining multi-container environments (app + database + cache).
*   **Kubernetes (K8s):** The standard for production orchestration. Focus on Deployments, Services, Ingress, and ConfigMaps for scalable architectures. Use local K8s (Minikube, kind) to test deployment manifests locally.
