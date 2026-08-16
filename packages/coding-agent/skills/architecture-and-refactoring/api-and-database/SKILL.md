---
name: api-and-database
description: API design (REST, GraphQL, gRPC), database engineering (schema design, indexing, migrations, query optimization), and data layer patterns. Use when designing APIs, optimizing queries, or choosing between data technologies.
---

# API and Database Engineering

This skill covers the design and engineering of APIs and the data layer that powers them. It provides patterns for building scalable, maintainable, and performant APIs and databases.

## Sub-Skills

- [REST API Design](./rest-api-design.md): Resource naming, pagination, versioning, rate limiting, error handling, and OpenAPI.
- [GraphQL Patterns](./graphql-patterns.md): Schema design, DataLoader, Relay connections, authorization, and code generation.
- [gRPC and RPC](./grpc-and-rpc.md): Protocol Buffers, streaming patterns, deadlines, load balancing, and tRPC.
- [Database Patterns](./database-patterns.md): Schema design, indexing, query optimization, migrations, and caching.

## API Paradigm Selection: REST vs GraphQL vs gRPC

Choosing the right API paradigm depends on the consumers and the nature of the data.

### REST
- **Best for:** Public APIs (Stripe, Twilio, GitHub), external integrations, and simple CRUD applications.
- **Pros:** Ubiquitous, highly cacheable (HTTP semantics), easy to explore without special tooling, standard status codes.
- **Cons:** Over-fetching or under-fetching, N+1 requests for related data, requires careful versioning.
- **When to choose:** You are building an API that external partners or customers will consume directly.

### GraphQL
- **Best for:** Complex frontend applications (SPA, mobile apps), aggregations over multiple microservices, and applications with highly variable data requirements.
- **Pros:** Solves over/under-fetching, client dictates data structure, strong typing, introspection.
- **Cons:** Complex caching, N+1 query risks on the backend, learning curve, query complexity management needed.
- **When to choose:** You have a rich frontend app (React/React Native) that needs flexible views of a graph-like data model.

### gRPC
- **Best for:** Microservice-to-microservice communication, high-performance internal APIs, polyglot environments.
- **Pros:** Extremely fast (HTTP/2 + binary Protobuf), strongly typed contracts, backward/forward compatibility built-in, streaming support.
- **Cons:** Not easily consumable from browsers (requires gRPC-Web proxy), harder to debug with network inspectors (binary payload).
- **When to choose:** You are building backend microservices that need to communicate with minimal latency and high throughput.

## Database Selection Criteria

- **PostgreSQL (RDBMS):** The default choice for most applications. ACID compliance, relational data, complex queries, JSONB support for document-like data. Use for primary business logic and transactional data.
- **Redis (Key-Value/In-Memory):** Ephemeral data, caching, rate limiting, pub/sub, distributed locking, and fast counters.
- **DynamoDB / Cassandra (Wide-Column/NoSQL):** Massive scale, high availability, predictable performance at scale. Requires careful partition key design. Difficult for complex ad-hoc queries.
- **Elasticsearch (Search):** Full-text search, log aggregation, complex filtering across unstructured data.
- **SQLite:** Embedded databases, mobile apps, desktop apps, local development, and testing. Surprisingly capable for read-heavy websites.
