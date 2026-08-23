export class BenchmarkOutputOverflowError extends Error {
  constructor(captureName, limitBytes, observedBytesAtLeast = limitBytes + 1) {
    super(`${captureName} exceeded ${limitBytes} bytes`);
    this.name = "BenchmarkOutputOverflowError";
    this.captureName = captureName;
    this.limitBytes = limitBytes;
    this.observedBytesAtLeast = observedBytesAtLeast;
  }
}
