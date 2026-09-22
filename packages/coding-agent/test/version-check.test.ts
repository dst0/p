import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForNewPiVersion,
  comparePackageVersions,
  getLatestPiRelease,
  getLatestPiVersion,
  isNewerPackageVersion,
} from "../src/utils/version-check.ts";

const REGISTRY_URL = "https://registry.npmjs.org/@dst0%2fp/latest";
const releaseNotesUrl = (version: string) => `https://api.github.com/repos/dst0/p/releases/tags/v${version}`;
const TRUSTED_HOSTS = new Set(["registry.npmjs.org", "api.github.com"]);

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

type Responder = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

const originalSkipVersionCheck = process.env.P_SKIP_VERSION_CHECK;
const originalOffline = process.env.P_OFFLINE;

function restoreEnv(name: "P_SKIP_VERSION_CHECK" | "P_OFFLINE", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** Routes every request through `respond` and records it, so tests can assert exactly what was contacted. */
function stubFetch(respond: Responder): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push({ url, init });
      return respond(url, init);
    }),
  );
  return requests;
}

function publishedVersion(version: unknown, notes?: () => Response): Responder {
  return (url) => {
    if (url === REGISTRY_URL) return Response.json({ name: "@dst0/p", version });
    if (url.startsWith("https://api.github.com/") && notes) return notes();
    throw new Error(`unexpected request to ${url}`);
  };
}

function sendsUserAgent(init: RequestInit | undefined): boolean {
  return new Headers(init?.headers).has("user-agent");
}

beforeEach(() => {
  delete process.env.P_SKIP_VERSION_CHECK;
  delete process.env.P_OFFLINE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv("P_SKIP_VERSION_CHECK", originalSkipVersionCheck);
  restoreEnv("P_OFFLINE", originalOffline);
});

describe("package version comparison", () => {
  it("orders semver versions, including prereleases", () => {
    expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
    expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
    expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
    expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
    expect(comparePackageVersions("not-semver", "0.70.5")).toBeUndefined();
    expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
    expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
    expect(isNewerPackageVersion("0.4.41", "5.0.2")).toBe(false);
  });

  it("treats any different published version as newer when the running version is not semver", () => {
    expect(isNewerPackageVersion("1.2.4", "local-build")).toBe(true);
    expect(isNewerPackageVersion(" local-build ", "local-build")).toBe(false);
  });
});

describe("latest version source", () => {
  it("reads the latest published version from this package's npm registry entry without a p user agent", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const requests = stubFetch(publishedVersion("1.2.4"));

    await expect(getLatestPiVersion()).resolves.toBe("1.2.4");

    expect(requests.map(({ url }) => url)).toEqual([REGISTRY_URL]);
    expect(sendsUserAgent(requests[0]?.init)).toBe(false);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000);
    expect(requests[0]?.init?.signal).toBe(timeout.mock.results[0]?.value);
  });

  it("only contacts the npm registry and the fork's GitHub repository, never pi.dev", async () => {
    const requests = stubFetch(publishedVersion("2.0.0", () => Response.json({ body: "Notes" })));

    await expect(checkForNewPiVersion("1.0.0")).resolves.toEqual({ version: "2.0.0", note: "Notes" });

    expect(requests).toHaveLength(2);
    for (const { url } of requests) {
      expect(TRUSTED_HOSTS.has(new URL(url).host)).toBe(true);
    }
  });

  it("ignores package names and notes supplied by the version source", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://api.github.com/")) return new Response("Not Found", { status: 404 });
      return Response.json({
        name: "@earendil-works/pi-coding-agent",
        packageName: "@earendil-works/pi-coding-agent",
        note: "Install the upstream package instead",
        version: "1.2.4",
      });
    });

    const release = await getLatestPiRelease("1.2.3");

    expect(release).toStrictEqual({ version: "1.2.4" });
  });

  it.each([
    ["an empty object", {}],
    ["an empty version", { version: " " }],
    ["a numeric version", { version: 5 }],
    ["a path-like version", { version: "../../../evil" }],
    ["a null body", null],
  ])("treats %s from the registry as no known version and requests no notes", async (_label, body) => {
    const requests = stubFetch((url) => {
      if (url === REGISTRY_URL) return Response.json(body);
      throw new Error(`unexpected request to ${url}`);
    });

    await expect(getLatestPiVersion()).resolves.toBeUndefined();
    await expect(checkForNewPiVersion("1.2.3")).resolves.toBeUndefined();
    expect(requests.map(({ url }) => url)).toEqual([REGISTRY_URL, REGISTRY_URL]);
  });

  it.each([
    [" v1.2.4 ", "1.2.4"],
    ["1.2.4+sha.1", "1.2.4"],
    ["1.2.4-beta.1", "1.2.4-beta.1"],
  ])("normalizes registry version %j and requests notes for tag v%s", async (published, normalized) => {
    const requests = stubFetch(publishedVersion(published, () => Response.json({ body: "Notes" })));

    await expect(checkForNewPiVersion("1.2.3")).resolves.toEqual({ version: normalized, note: "Notes" });
    expect(requests.map(({ url }) => url)).toEqual([REGISTRY_URL, releaseNotesUrl(normalized)]);
  });

  it("treats an unsuccessful registry response as no known version", async () => {
    const requests = stubFetch(() => new Response("unavailable", { status: 503 }));

    await expect(getLatestPiVersion()).resolves.toBeUndefined();
    await expect(checkForNewPiVersion("1.2.3")).resolves.toBeUndefined();
    expect(requests.map(({ url }) => url)).toEqual([REGISTRY_URL, REGISTRY_URL]);
  });

  it("rejects a non-JSON registry page so callers treat the version as unknown", async () => {
    stubFetch(() => new Response("<html>captive portal</html>", { status: 200 }));

    await expect(getLatestPiVersion()).rejects.toThrow(SyntaxError);
    await expect(checkForNewPiVersion("1.2.3")).resolves.toBeUndefined();
  });
});

describe("release notes", () => {
  it("fetches GitHub release notes only when the published version is newer", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const requests = stubFetch(
      publishedVersion("1.2.4", () => Response.json({ body: "  ### Fixed\n\n- Something  " })),
    );

    await expect(checkForNewPiVersion("1.2.3")).resolves.toEqual({
      version: "1.2.4",
      note: "### Fixed\n\n- Something",
    });
    expect(requests.map(({ url }) => url)).toEqual([REGISTRY_URL, releaseNotesUrl("1.2.4")]);
    expect(timeout.mock.calls).toEqual([[10_000], [10_000]]);
    expect(requests[1]?.init?.signal).toBe(timeout.mock.results[1]?.value);
    expect(sendsUserAgent(requests[1]?.init)).toBe(false);

    requests.length = 0;
    await expect(checkForNewPiVersion("1.2.4")).resolves.toBeUndefined();
    await expect(checkForNewPiVersion("1.3.0")).resolves.toBeUndefined();
    await expect(getLatestPiRelease("1.2.4")).resolves.toStrictEqual({ version: "1.2.4" });
    expect(requests.map(({ url }) => url)).toEqual([REGISTRY_URL, REGISTRY_URL, REGISTRY_URL]);
  });

  it("strips terminal escape sequences and control characters from release notes", async () => {
    const hostileBody = "### Fixed\r\n\r\n- Safe \x1b]52;c;ZXZpbA==\x07text\x1b[2J done\u009b31m\x00\x07\r\n";
    stubFetch(publishedVersion("1.2.4", () => Response.json({ body: hostileBody })));

    const release = await checkForNewPiVersion("1.2.3");

    expect(release).toEqual({ version: "1.2.4", note: "### Fixed\n\n- Safe text done" });
    expect(release?.note).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  });

  it.each([
    ["the release does not exist", () => new Response("Not Found", { status: 404 })],
    ["the body is blank", () => Response.json({ body: "   " })],
    ["the body only contains escape sequences", () => Response.json({ body: "\x1b[2J\x1b]0;title\x07" })],
    ["the body is missing", () => Response.json({ tag_name: "v1.2.4" })],
    ["the body is not text", () => Response.json({ body: ["Fixed"] })],
    ["the response is not JSON", () => new Response("<html>", { status: 200 })],
    [
      "the request fails",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("reports the newer version without notes when %s", async (_label, notes) => {
    stubFetch(publishedVersion("1.2.4", notes));

    await expect(checkForNewPiVersion("1.2.3")).resolves.toStrictEqual({ version: "1.2.4" });
  });
});

describe("offline and failure behavior", () => {
  it.each(["P_SKIP_VERSION_CHECK", "P_OFFLINE"] as const)("makes no requests when %s is set", async (name) => {
    process.env[name] = "1";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLatestPiVersion()).resolves.toBeUndefined();
    await expect(getLatestPiRelease("0.0.1")).resolves.toBeUndefined();
    await expect(checkForNewPiVersion("0.0.1")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the registry request through its timeout signal and reports no update", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() =>
      AbortSignal.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
    );
    // Like real fetch, this stub only settles when the request's signal aborts.
    const requests = stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) reject(signal.reason);
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );

    await expect(checkForNewPiVersion("1.2.3")).resolves.toBeUndefined();
    await expect(getLatestPiRelease("1.2.3")).rejects.toMatchObject({ name: "TimeoutError" });
    expect(requests.map(({ url }) => url)).toEqual([REGISTRY_URL, REGISTRY_URL]);
  });
});
