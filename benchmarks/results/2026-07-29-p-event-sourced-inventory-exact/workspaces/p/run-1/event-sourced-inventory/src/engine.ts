import {
  type InventoryEvent,
  type LogManifest,
  EventStore,
  ValidationError,
} from "./store.js";

// ---- Types ----

export interface InventoryState {
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  reservations: Record<string, number>;
  version: number;
}

export interface ExecuteOptions {
  commandId: string;
  expectedVersion: number;
}

export interface BatchItem {
  command: Command;
  commandId: string;
  expectedVersion: number;
}

export interface CommandResult {
  type: string;
  sku: string;
  version: number;
  position: number;
  commandId: string;
}

export type Command =
  | { type: "create-sku"; sku: string }
  | { type: "receive"; sku: string; quantity: number }
  | { type: "reserve"; sku: string; orderId: string; quantity: number }
  | { type: "release"; sku: string; orderId: string; quantity: number }
  | { type: "ship"; sku: string; orderId: string; quantity: number };

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyError";
  }
}

// ---- Engine ----

export class InventoryEngine {
  private store: EventStore;
  private states: Map<string, InventoryState>;
  // Idempotency: commandId -> { event, result }
  private idempotency: Map<string, { event: InventoryEvent; result: CommandResult }>;

  constructor() {
    this.store = new EventStore();
    this.states = new Map();
    this.idempotency = new Map();
  }

  /** Execute a single command. */
  execute(command: Command, opts: ExecuteOptions): CommandResult {
    const { commandId, expectedVersion } = opts;
    validateCommandInput(command, commandId);

    // Idempotency check
    const cached = this.idempotency.get(commandId);
    if (cached) {
      // Reusing same commandId with same command -> return cached result
      // Reusing same commandId with different command -> throw
      if (!commandsEqual(command, cached.event)) {
        throw new ValidationError(
          `Command ID '${commandId}' already used with a different command`,
        );
      }
      return structuredClone(cached.result);
    }

    const sku = command.sku;
    const state = this.states.get(sku);

    // Concurrency check
    const currentVersion = state?.version ?? 0;
    if (expectedVersion !== currentVersion) {
      throw new ConcurrencyError(
        `Expected version ${expectedVersion} for SKU '${sku}', but current version is ${currentVersion}`,
      );
    }

    // Validate domain rules
    validateCommand(command, state);

    // Apply the command and get new state
    const newState = applyCommand(command, state);
    this.states.set(sku, newState);

    // Append event to store
    const eventType = command.type;
    const eventData = buildEventData(command);
    const event = this.store.append(
      eventType,
      sku,
      newState.version,
      commandId,
      eventData,
    );

    const result: CommandResult = {
      type: eventType,
      sku,
      version: newState.version,
      position: event.position,
      commandId,
    };

    // Record idempotency (store a deep clone so external mutations don't affect cache)
    this.idempotency.set(commandId, { event, result: structuredClone(result) });

    return result;
  }

  /**
   * Execute a batch of commands atomically.
   * Either all commands commit or no observable state changes.
   */
  executeBatch(items: BatchItem[]): CommandResult[] {
    // Snapshot current state for rollback
    const snapshotStates = new Map(this.states);
    const snapshotStoreEvents = this.store.getAll();
    const snapshotIdempotency = new Map(this.idempotency);
    const results: CommandResult[] = [];

    try {
      for (const item of items) {
        const result = this.execute(item.command, {
          commandId: item.commandId,
          expectedVersion: item.expectedVersion,
        });
        results.push(result);
      }
    } catch (err) {
      // Rollback: restore everything
      this.states = snapshotStates;
      this.store.restoreFromEvents(snapshotStoreEvents);
      this.idempotency = snapshotIdempotency;
      throw err;
    }

    return results;
  }

  /** Return a deep copy of current state for a SKU. */
  state(sku: string): InventoryState {
    const s = this.states.get(sku);
    if (!s) {
      throw new ValidationError(`SKU '${sku}' not found`);
    }
    return structuredClone(s);
  }

  /** Return a deep copy of event history for a SKU. */
  history(sku: string): InventoryEvent[] {
    const allEvents = this.store.getAll();
    const skuEvents = allEvents.filter((e) => e.sku === sku);
    return structuredClone(skuEvents);
  }

  /** Export the event log as deterministic JSONL. */
  exportLog(): string {
    return this.store.exportLog();
  }

  /**
   * Restore an engine from an exported JSONL log.
   * Validates structure, hash chain, positions, stream versions, manifest, and domain transitions.
   */
  static fromLog(log: string): InventoryEngine {
    const engine = new InventoryEngine();

    // Parse and validate the log (validates hash chain, positions, etc.)
    const store = EventStore.fromLog(log);
    engine.store = store;

    // Replay all events to rebuild state
    const allEvents = store.getAll();
    const states: Map<string, InventoryState> = new Map();
    const idempotency: Map<string, { event: InventoryEvent; result: CommandResult }> = new Map();

    for (const evt of allEvents) {
      const prevState = states.get(evt.sku);
      const command = eventToCommand(evt);
      const newState = applyCommand(command, prevState);
      states.set(evt.sku, newState);

      const result: CommandResult = {
        type: evt.type,
        sku: evt.sku,
        version: evt.version,
        position: evt.position,
        commandId: evt.commandId,
      };
      idempotency.set(evt.commandId, { event: evt, result });
    }

    engine.states = states;
    engine.idempotency = idempotency;

    return engine;
  }
}

// ---- Command validation ----

function validateCommandInput(command: Command, commandId: string): void {
  const trimmedSku = command.sku.trim();
  if (!trimmedSku) {
    throw new ValidationError("SKU must be a non-empty string");
  }

  const trimmedCommandId = commandId.trim();
  if (!trimmedCommandId) {
    throw new ValidationError("Command ID must be a non-empty string");
  }

  if (
    command.type === "receive" ||
    command.type === "reserve" ||
    command.type === "release" ||
    command.type === "ship"
  ) {
    const qty = command.quantity;
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ValidationError("Quantity must be a positive integer");
    }
  }

  if (
    command.type === "reserve" ||
    command.type === "release" ||
    command.type === "ship"
  ) {
    const trimmedOrderId = command.orderId.trim();
    if (!trimmedOrderId) {
      throw new ValidationError("Order ID must be a non-empty string");
    }
  }
}

function validateCommand(
  command: Command,
  state: InventoryState | undefined,
): void {
  switch (command.type) {
    case "create-sku":
      if (state !== undefined) {
        throw new ValidationError(
          `SKU '${command.sku}' already exists`,
        );
      }
      break;

    case "receive":
      if (state === undefined) {
        throw new ValidationError(`SKU '${command.sku}' does not exist`);
      }
      break;

    case "reserve":
      if (state === undefined) {
        throw new ValidationError(`SKU '${command.sku}' does not exist`);
      }
      if (command.quantity > state.available) {
        throw new ValidationError(
          `Cannot reserve ${command.quantity} units of '${command.sku}': only ${state.available} available`,
        );
      }
      break;

    case "release": {
      if (state === undefined) {
        throw new ValidationError(`SKU '${command.sku}' does not exist`);
      }
      const reservation = state.reservations[command.orderId] ?? 0;
      if (command.quantity > reservation) {
        throw new ValidationError(
          `Cannot release ${command.quantity} units for order '${command.orderId}' on SKU '${command.sku}': only ${reservation} reserved`,
        );
      }
      break;
    }

    case "ship": {
      if (state === undefined) {
        throw new ValidationError(`SKU '${command.sku}' does not exist`);
      }
      const reservation = state.reservations[command.orderId] ?? 0;
      if (command.quantity > reservation) {
        throw new ValidationError(
          `Cannot ship ${command.quantity} units for order '${command.orderId}' on SKU '${command.sku}': only ${reservation} reserved`,
        );
      }
      break;
    }
  }
}

// ---- Command application ----

function applyCommand(
  command: Command,
  state: InventoryState | undefined,
): InventoryState {
  switch (command.type) {
    case "create-sku":
      return {
        sku: command.sku,
        onHand: 0,
        reserved: 0,
        available: 0,
        reservations: {},
        version: 1,
      };

    case "receive":
      return {
        ...state!,
        onHand: state!.onHand + command.quantity,
        available: state!.available + command.quantity,
        version: state!.version + 1,
      };

    case "reserve": {
      const newReservations = { ...state!.reservations };
      const existing = newReservations[command.orderId] ?? 0;
      newReservations[command.orderId] = existing + command.quantity;
      return {
        ...state!,
        reserved: state!.reserved + command.quantity,
        available: state!.available - command.quantity,
        reservations: newReservations,
        version: state!.version + 1,
      };
    }

    case "release": {
      const currentReservation = state!.reservations[command.orderId] ?? 0;
      const newReservations = { ...state!.reservations };
      newReservations[command.orderId] = currentReservation - command.quantity;
      return {
        ...state!,
        reserved: state!.reserved - command.quantity,
        available: state!.available + command.quantity,
        reservations: newReservations,
        version: state!.version + 1,
      };
    }

    case "ship": {
      const currentReservation = state!.reservations[command.orderId] ?? 0;
      const newReservations = { ...state!.reservations };
      newReservations[command.orderId] = currentReservation - command.quantity;
      return {
        ...state!,
        onHand: state!.onHand - command.quantity,
        reserved: state!.reserved - command.quantity,
        reservations: newReservations,
        version: state!.version + 1,
      };
    }

    default:
      throw new ValidationError(`Unknown command type: ${(command as Command).type}`);
  }
}

// ---- Helpers ----

function buildEventData(command: Command): Record<string, unknown> {
  switch (command.type) {
    case "create-sku":
      return {};
    case "receive":
      return { quantity: command.quantity };
    case "reserve":
      return { orderId: command.orderId, quantity: command.quantity };
    case "release":
      return { orderId: command.orderId, quantity: command.quantity };
    case "ship":
      return { orderId: command.orderId, quantity: command.quantity };
  }
}

function eventToCommand(event: InventoryEvent): Command {
  switch (event.type) {
    case "create-sku":
      return { type: "create-sku", sku: event.sku };
    case "receive":
      return {
        type: "receive",
        sku: event.sku,
        quantity: event.data.quantity as number,
      };
    case "reserve":
      return {
        type: "reserve",
        sku: event.sku,
        orderId: event.data.orderId as string,
        quantity: event.data.quantity as number,
      };
    case "release":
      return {
        type: "release",
        sku: event.sku,
        orderId: event.data.orderId as string,
        quantity: event.data.quantity as number,
      };
    case "ship":
      return {
        type: "ship",
        sku: event.sku,
        orderId: event.data.orderId as string,
        quantity: event.data.quantity as number,
      };
    default:
      throw new ValidationError(`Unknown event type: ${event.type}`);
  }
}

function commandsEqual(command: Command, event: InventoryEvent): boolean {
  if (command.type !== event.type) return false;
  if (command.sku !== event.sku) return false;

  switch (command.type) {
    case "create-sku":
      return true;
    case "receive":
      return command.quantity === (event.data.quantity as number);
    case "reserve":
      return (
        command.orderId === (event.data.orderId as string) &&
        command.quantity === (event.data.quantity as number)
      );
    case "release":
      return (
        command.orderId === (event.data.orderId as string) &&
        command.quantity === (event.data.quantity as number)
      );
    case "ship":
      return (
        command.orderId === (event.data.orderId as string) &&
        command.quantity === (event.data.quantity as number)
      );
  }
}
