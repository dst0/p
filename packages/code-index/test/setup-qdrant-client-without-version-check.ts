import type * as QdrantRest from "@qdrant/js-client-rest";
import { vi } from "vitest";

/**
 * Registered through `setupFiles`, so it applies to every test file in this package.
 *
 * The raw `@qdrant/js-client-rest` constructor fires a fire-and-forget `GET /` version check and reports a failure
 * with `console.warn` whenever it settles. Tests construct `QdrantClient`/`CodeIndexer` without a Qdrant server, so
 * that check fails a few milliseconds later: after the constructing test finished and its console spies were
 * restored, or even while Vitest tears the worker down. The late write then races the worker RPC and surfaces as
 * `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`, failing an otherwise green run.
 *
 * Disabling the check for tests removes the unawaited network request and the console write. Production code keeps
 * the library default.
 */
vi.mock("@qdrant/js-client-rest", async (importOriginal) => {
  const actual = await importOriginal<typeof QdrantRest>();

  class QdrantClientWithoutVersionCheck extends actual.QdrantClient {
    constructor(args?: ConstructorParameters<typeof actual.QdrantClient>[0]) {
      super({ ...args, checkCompatibility: false });
    }
  }

  return { ...actual, QdrantClient: QdrantClientWithoutVersionCheck };
});
