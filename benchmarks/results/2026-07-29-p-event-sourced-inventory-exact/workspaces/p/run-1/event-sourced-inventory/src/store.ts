import { createHash } from "node:crypto";

// ---- Types ----

export interface InventoryEvent {
  position: number;
  version: number;
  commandId: string;
  type: string;
  sku: string;
  data: Record<string, unknown>;
  previousHash: string | null;
  hash: string;
}

export interface LogManifest {
  type: "manifest";
  eventCount: number;
  headHash: string;
}

// ---- Store ----

/**
 * Append-only in-memory event log with SHA-256 hash chaining.
 *
 * Each event's `hash` is SHA-256 over the canonical JSON string:
 *   { position, version, commandId, type, sku, data, previousHash }
 * i.e. the hash field itself is excluded from its own digest.
 * The first event has previousHash = null.
 */
export class EventStore {
  private events: InventoryEvent[] = [];
  private nextPosition = 1;

  /** Append a single event (caller has validated domain rules). Returns the event. */
  append(
    type: string,
    sku: string,
    version: number,
    commandId: string,
    data: Record<string, unknown>,
  ): InventoryEvent {
    const previousHash =
      this.events.length > 0 ? this.events[this.events.length - 1].hash : null;

    const canonical = JSON.stringify({
      position: this.nextPosition,
      version,
      commandId,
      type,
      sku,
      data,
      previousHash,
    });

    const hash = createHash("sha256").update(canonical).digest("hex");

    const event: InventoryEvent = {
      position: this.nextPosition,
      version,
      commandId,
      type,
      sku,
      data,
      previousHash,
      hash,
    };

    this.events.push(event);
    this.nextPosition++;
    return event;
  }

  /** Return a deep copy of all events. */
  getAll(): InventoryEvent[] {
    return structuredClone(this.events);
  }

  /** Export deterministic JSONL: one line per event, then a manifest line. */
  exportLog(): string {
    let lines: string[] = [];
    for (const evt of this.events) {
      lines.push(JSON.stringify(evt));
    }
    const manifest: LogManifest = {
      type: "manifest",
      eventCount: this.events.length,
      headHash:
        this.events.length > 0
          ? this.events[this.events.length - 1].hash
          : "",
    };
    lines.push(JSON.stringify(manifest));
    return lines.join("\n") + "\n";
  }

  /**
   * Restore from an exported JSONL log.  Validates every structural invariant,
   * hash chain, positions, stream versions, and the manifest.
   * Throws ValidationError on any problem.
   */
  static fromLog(raw: string): EventStore {
    const store = new EventStore();
    const lines = raw.split("\n");
    // Last line is the manifest; lines before that are events.
    // Trailing newline means a final empty string element.
    let eventLines: string[] = [];
    let manifestLine: string | null = null;

    // Strip trailing empty string from final newline
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    if (lines.length === 0) {
      throw new ValidationError("Log is empty");
    }

    manifestLine = lines[lines.length - 1];
    eventLines = lines.slice(0, lines.length - 1);

    // Parse and validate manifest
    let manifest: LogManifest;
    try {
      manifest = JSON.parse(manifestLine);
    } catch {
      throw new ValidationError("Manifest line is not valid JSON");
    }

    if (manifest.type !== "manifest") {
      throw new ValidationError("Manifest must have type 'manifest'");
    }
    if (typeof manifest.eventCount !== "number") {
      throw new ValidationError("Manifest eventCount must be a number");
    }
    if (manifest.eventCount !== eventLines.length) {
      throw new ValidationError(
        `Manifest eventCount (${manifest.eventCount}) does not match actual event count (${eventLines.length})`,
      );
    }

    // Parse events
    const parsedEvents: InventoryEvent[] = [];
    for (let i = 0; i < eventLines.length; i++) {
      const line = eventLines[i];
      if (!line || line.trim() === "") {
        throw new ValidationError(`Empty event line at index ${i}`);
      }
      let evt: InventoryEvent;
      try {
        evt = JSON.parse(line);
      } catch {
        throw new ValidationError(`Event line ${i} is not valid JSON`);
      }
      parsedEvents.push(evt);
    }

    // Validate each event
    let expectedPosition = 1;
    let previousHash: string | null = null;

    // Track per-SKU versions to validate stream ordering
    const skuVersions = new Map<string, number>();
    // Track command IDs to ensure no duplicates
    const commandIds = new Set<string>();

    for (let i = 0; i < parsedEvents.length; i++) {
      const evt = parsedEvents[i];

      // Position validation
      if (evt.position !== expectedPosition) {
        throw new ValidationError(
          `Event at line ${i}: expected position ${expectedPosition}, got ${evt.position}`,
        );
      }

      // Hash chain validation
      if (evt.previousHash !== previousHash) {
        throw new ValidationError(
          `Event at line ${i}: previousHash chain broken`,
        );
      }

      // Canonical hash recomputation
      const canonicalInput = {
        position: evt.position,
        version: evt.version,
        commandId: evt.commandId,
        type: evt.type,
        sku: evt.sku,
        data: evt.data,
        previousHash: evt.previousHash,
      };
      const canonical = JSON.stringify(canonicalInput);
      const computedHash: string = createHash("sha256").update(canonical).digest("hex");
      if (evt.hash !== computedHash) {
        throw new ValidationError(
          `Event at line ${i}: hash mismatch (tampered or corrupted)`,
        );
      }

      // Command ID uniqueness
      if (commandIds.has(evt.commandId)) {
        throw new ValidationError(
          `Event at line ${i}: duplicate commandId '${evt.commandId}'`,
        );
      }
      commandIds.add(evt.commandId);

      // Per-SKU version validation
      const expectedVersion = (skuVersions.get(evt.sku) ?? 0) + 1;
      if (evt.version !== expectedVersion) {
        throw new ValidationError(
          `Event at line ${i}: SKU '${evt.sku}' expected version ${expectedVersion}, got ${evt.version}`,
        );
      }
      skuVersions.set(evt.sku, evt.version);

      // Domain transition validation
      validateTransition(evt, skuVersions);

      // Update previousHash for next event
      previousHash = evt.hash;
      expectedPosition++;

      // Rebuild state by re-appending to the store
      store.pushEvent(structuredClone(evt));
    }

    // Validate manifest headHash
    if (store.events.length > 0) {
      const lastHash = store.events[store.events.length - 1].hash;
      if (manifest.headHash !== lastHash) {
        throw new ValidationError("Manifest headHash does not match last event hash");
      }
    } else {
      if (manifest.headHash !== "") {
        throw new ValidationError("Manifest headHash should be empty for empty log");
      }
    }

    return store;
  }

  /** Internal: push a pre-validated event during fromLog. */
  private pushEvent(evt: InventoryEvent): void {
    this.events.push(evt);
    this.nextPosition = evt.position + 1;
  }

  /** Restore the store from a snapshot of events (used for batch rollback). */
  restoreFromEvents(events: InventoryEvent[]): void {
    this.events = structuredClone(events);
    if (events.length > 0) {
      this.nextPosition = events[events.length - 1].position + 1;
    } else {
      this.nextPosition = 1;
    }
  }

  /** Return the next position for a new event. */
  getNextPosition(): number {
    return this.nextPosition;
  }
}

/** Validate that an event represents a legal domain transition given current per-SKU versions. */
function validateTransition(
  evt: InventoryEvent,
  skuVersions: Map<string, number>,
): void {
  const version = evt.version;
  if (version === 1 && evt.type === "create-sku") {
    // First event for a SKU must be create-sku
    return;
  }
  if (version === 1 && evt.type !== "create-sku") {
    throw new ValidationError(
      `Event at position ${evt.position}: first event for SKU '${evt.sku}' must be create-sku`,
    );
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
