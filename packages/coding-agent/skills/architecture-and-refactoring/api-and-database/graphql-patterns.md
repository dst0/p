# GraphQL Engineering Patterns

GraphQL provides immense flexibility for clients but shifts complexity to the server.

## Schema Design

- **Types vs Interfaces:** Use Interfaces when multiple types share common fields (e.g., `Node` interface with an `id` field).
- **Unions:** Use Unions when a field can return different unrelated types (e.g., `SearchResult` returning `User | Post | Comment`).
- **Input Types:** Group mutation arguments into descriptive input types instead of passing many loose arguments.

```graphql
input UpdateUserInput {
  id: ID!
  name: String
  email: String
}

type Mutation {
  updateUser(input: UpdateUserInput!): User!
}
```

## The N+1 Problem and DataLoader

GraphQL resolvers run independently. Requesting `users` and their `posts` can cause an N+1 query problem (1 query for users, N queries for each user's posts).

**Solution:** Use the DataLoader pattern (usually backed by a per-request cache). It batches IDs and executes a single query.

```typescript
// TypeScript Example with dataloader
const postLoader = new DataLoader(async (userIds) => {
  // 1 query for all users
  const posts = await db.posts.findMany({ where: { userId: { in: userIds } } });
  
  // Group posts by user ID
  const postsByUserId = groupBy(posts, 'userId');
  
  // Must return array in same order as userIds
  return userIds.map(id => postsByUserId[id] || []);
});

// In resolver
const resolvers = {
  User: {
    posts: (user) => postLoader.load(user.id)
  }
};
```

## Pagination (Relay Cursor Connections)

Standardize pagination using the Relay Connection pattern. It allows for cursors, total counts, and page info.

```graphql
type PostConnection {
  edges: [PostEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type PostEdge {
  cursor: String!
  node: Post!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}
```

## Authentication and Authorization

- **Authentication:** Handle at the HTTP middleware layer (set `user` on the GraphQL `context`).
- **Authorization:** Handle at the resolver layer or deeper in the business logic, not in the GraphQL routing layer.

## Persisted Queries and Query Complexity

- **Persisted Queries:** Prevent arbitrary queries in production. At build time, clients hash their queries and send only the hash. The server looks up the hash to find the allowed query.
- **Query Complexity:** Assign point values to fields and limits to connections. Reject queries that exceed a maximum complexity score to prevent DoS attacks.

## Schema Evolution and Deprecation

GraphQL APIs are generally versionless. 
- Evolve schemas by adding new fields, never changing or removing existing ones.
- Use the `@deprecated` directive to signal clients to migrate.
- Monitor field usage analytics (e.g., Apollo Studio) before finally dropping deprecated fields.

## Code Generation

Never write types manually. Use tools like:
- **graphql-codegen:** Generates TypeScript types for resolvers and client queries based on the `.graphql` schema.
- **Pothos (TypeScript):** A code-first schema builder that heavily uses TypeScript inference to ensure your schema and resolvers are always in sync.
