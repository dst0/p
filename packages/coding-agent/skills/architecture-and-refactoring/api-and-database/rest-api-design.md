# RESTful API Engineering

Designing a REST API requires careful attention to resource modeling, HTTP semantics, and developer experience.

## Resource Naming and URL Structure

- Use nouns, not verbs: `/users` instead of `/getUsers`.
- Use plural nouns consistently: `/users/123`, `/invoices/456`.
- Nest resources to show relationships, but keep it shallow (max 2 levels): `/users/123/orders` (Good). `/users/123/orders/456/items/789` (Bad, use `/orders/456/items`).
- Use kebab-case for URLs: `/billing-profiles`.

### HTTP Method Semantics
- `GET`: Idempotent, safe. Retrieve resource(s).
- `POST`: Non-idempotent. Create a new resource or trigger an action (e.g., `/invoices/123/pay`).
- `PUT`: Idempotent. Replace a resource entirely.
- `PATCH`: Idempotent (mostly). Partially update a resource.
- `DELETE`: Idempotent. Remove a resource.

## Pagination

Always paginate list endpoints. Avoid offset pagination for large datasets due to performance degradation (`OFFSET 10000` requires reading and discarding 10,000 rows).

### Cursor-based Pagination (Stripe / GitHub Pattern)
Provides stable pagination even if data changes during iteration.

```json
// Request: GET /v1/charges?limit=2&starting_after=ch_123
// Response:
{
  "object": "list",
  "has_more": true,
  "data": [
    { "id": "ch_124", "amount": 1000 },
    { "id": "ch_125", "amount": 2500 }
  ]
}
```

## Filtering, Sorting, and Field Selection

- **Filtering:** Use query parameters. `/users?status=active&created_at[gte]=2023-01-01`.
- **Sorting:** Use a `sort` parameter. `/users?sort=-created_at,name` (prefix with `-` for descending).
- **Sparse Fieldsets:** Allow clients to request specific fields to save bandwidth. `/users?fields=id,name,email`.

## Versioning Strategies

1. **URL Path (Most common):** `/v1/users`. Easy to route, visible. (Stripe, GitHub v3).
2. **Header:** `API-Version: 2023-01-01`. Keeps URLs clean.
3. **Content Negotiation (Accept Header):** `Accept: application/vnd.github.v3+json`. Purest REST, but harder to test in browser.

*Stripe Pattern:* URLs don't change versions, but the API expects a version header (`Stripe-Version: 2023-10-16`), which is pinned to the user's account upon creation, allowing seamless background upgrades.

## Rate Limiting

Protect APIs from abuse using Token Bucket or Sliding Window algorithms (usually via Redis).

- Return `429 Too Many Requests`.
- Include rate limit headers:
  - `X-RateLimit-Limit`: Maximum requests per window.
  - `X-RateLimit-Remaining`: Remaining requests.
  - `X-RateLimit-Reset`: Epoch time when limit resets.
  - `Retry-After`: Seconds to wait before retrying.

## Error Response Format (RFC 7807)

Use a consistent, structured error format like Problem Details (RFC 7807).

```json
{
  "type": "https://api.example.com/errors/out-of-credit",
  "title": "You do not have enough credit.",
  "status": 403,
  "detail": "Your current balance is 30, but that costs 50.",
  "instance": "/account/12345/msgs/abc",
  "balance": 30,
  "accounts": ["/account/12345", "/account/67890"]
}
```

## HATEOAS and Hypermedia

Hypermedia as the Engine of Application State involves returning links to state transitions.
- **When it's worth it:** Systems where state machines are complex and driven by the backend (e.g., checkout flows).
- **When it isn't:** Standard CRUD APIs where clients statically map endpoints. Often over-engineered.

## Batch & Bulk Operations

When exposing bulk endpoints (e.g. `POST /v1/items/batch` or `executeBatch(items)`):
- Return a direct collection of results (e.g. `ItemResult[]` or `{ data: ItemResult[] }`) ordered matching input items.
- Avoid arbitrary single-property wrapper objects unless mandated by schema standards.
- In transactional batch execution, enforce all-or-nothing atomicity: if one item fails, the entire batch rolls back with zero partial side effects.

## OpenAPI / Swagger

Always define APIs using OpenAPI (OAS3). 
- Use code-first generation (e.g., FastAPI in Python, tsoa in TypeScript) to keep docs and code in sync.
- Or use design-first generation, using a tool like Spectral to lint the spec, and openapi-generator to generate server stubs and SDKs.
