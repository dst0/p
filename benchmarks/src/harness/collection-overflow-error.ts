export class BenchmarkCollectionOverflowError extends Error {
  readonly captureName: string;
  readonly limitCount: number;
  readonly observedCountAtLeast: number;

  constructor(captureName: string, limitCount: number, observedCountAtLeast = limitCount + 1) {
    super(`${captureName} exceeded ${limitCount} entries`);
    this.name = "BenchmarkCollectionOverflowError";
    this.captureName = captureName;
    this.limitCount = limitCount;
    this.observedCountAtLeast = observedCountAtLeast;
  }
}
