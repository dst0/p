import { BenchmarkCollectionOverflowError, BenchmarkOutputOverflowError } from "./output-capture.ts";

export interface RecordingRetentionBudget {
  ensureCollectionEntry(captureName: string, currentEntries: number): void;
  release(bytes: number): void;
  replace(previousBytes: number, value: unknown): number;
  reserve(value: unknown): number;
}

function serializedBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
}

export function createRecordingRetentionBudget(
  captureName: string,
  limitBytes: number,
  collectionLimit: number,
): RecordingRetentionBudget {
  let retainedBytes = 0;
  const reserveBytes = (nextBytes: number): number => {
    const observedBytes = retainedBytes + nextBytes;
    if (observedBytes > limitBytes) {
      throw new BenchmarkOutputOverflowError(captureName, limitBytes, observedBytes);
    }
    retainedBytes = observedBytes;
    return nextBytes;
  };
  return {
    ensureCollectionEntry(entryName, currentEntries) {
      if (currentEntries >= collectionLimit) {
        throw new BenchmarkCollectionOverflowError(entryName, collectionLimit, currentEntries + 1);
      }
    },
    release(bytes) {
      retainedBytes -= bytes;
    },
    replace(previousBytes, value) {
      retainedBytes -= previousBytes;
      try {
        return reserveBytes(serializedBytes(value));
      } catch (error) {
        retainedBytes += previousBytes;
        throw error;
      }
    },
    reserve(value) {
      return reserveBytes(serializedBytes(value));
    },
  };
}
