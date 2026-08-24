export class BenchmarkOutputOverflowError extends Error {
  readonly captureName: string;
  readonly limitBytes: number;
  readonly observedBytesAtLeast: number;

  constructor(captureName: string, limitBytes: number, observedBytesAtLeast = limitBytes + 1) {
    super(`${captureName} exceeded ${limitBytes} bytes`);
    this.name = "BenchmarkOutputOverflowError";
    this.captureName = captureName;
    this.limitBytes = limitBytes;
    this.observedBytesAtLeast = observedBytesAtLeast;
  }
}
