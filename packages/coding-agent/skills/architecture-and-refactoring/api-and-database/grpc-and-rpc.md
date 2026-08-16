# gRPC and RPC Patterns

gRPC is a high-performance, open-source universal RPC framework, utilizing HTTP/2 and Protocol Buffers (Protobuf).

## Protocol Buffers Schema Design

Protobuf enforces strong contracts.

```protobuf
syntax = "proto3";
package users.v1;

service UserService {
  rpc GetUser (GetUserRequest) returns (GetUserResponse);
}

message GetUserRequest {
  string user_id = 1;
}

message GetUserResponse {
  string user_id = 1;
  string name = 2;
  string email = 3;
}
```

### Evolution Rules
- **Never change the tag number of an existing field.** The tag number identifies the field in the binary format.
- **Never change the type of a field.** (With very rare exceptions).
- **Never remove a required field** (proto2) or assume a field will always be populated.
- When deleting a field, use the `reserved` keyword to prevent the tag number from being reused, which could cause corruption with old clients.
  ```protobuf
  reserved 2, 15, 9 to 11;
  reserved "old_field_name";
  ```

## gRPC Service Patterns

1. **Unary RPC:** Client sends a single request, server returns a single response (like standard REST).
2. **Server Streaming:** Client sends a single request, server returns a stream of messages. Good for large datasets or subscriptions.
3. **Client Streaming:** Client sends a stream of messages, server returns a single response. Good for large uploads.
4. **Bidirectional Streaming:** Both client and server send a stream of messages. Good for chat, real-time sync.

## Error Handling

gRPC uses standard status codes (e.g., `NOT_FOUND`, `PERMISSION_DENIED`, `UNAUTHENTICATED`).
Do not put error flags inside the response message. Use the gRPC error model.

Attach rich error details using `google.rpc.Status`:
```protobuf
// Attach BadRequst details to the trailing metadata of the error
message BadRequest {
  message FieldViolation {
    string field = 1;
    string description = 2;
  }
  repeated FieldViolation field_violations = 1;
}
```

## Deadlines and Cancellation

- **Deadlines:** Clients should always set a deadline for how long they are willing to wait for an RPC to complete.
- **Cancellation Propagation:** If a client cancels a request or the deadline expires, the server should detect this and cancel downstream requests to other microservices or database queries to save resources.

## Load Balancing

gRPC connections are persistent HTTP/2 streams. Standard L4 load balancers will route the connection to a single backend, leading to uneven load.
- **Client-Side Load Balancing:** Clients know about all server endpoints (e.g., via DNS or a control plane) and distribute requests over multiple connections.
- **Proxy Load Balancing:** Use an L7 proxy (like Envoy or Nginx) that understands HTTP/2 frames and can multiplex individual gRPC requests across backend instances.

## Web Clients

Browsers cannot natively communicate via HTTP/2 framing required by standard gRPC.
- **gRPC-Web:** A JS client library and a proxy (usually Envoy) that translates between HTTP/1.1 (or browser HTTP/2) and backend gRPC.

## tRPC (TypeScript Alternative)

For full-stack TypeScript applications where the frontend and backend live in the same monorepo, **tRPC** has emerged as a popular alternative.
- It provides end-to-end type safety without code generation or Protobuf schemas.
- Uses standard HTTP under the hood.
- Excellent developer experience but restricted to TypeScript environments.
