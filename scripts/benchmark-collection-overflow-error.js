export class BenchmarkCollectionOverflowError extends Error {
  constructor(captureName, limitCount, observedCountAtLeast = limitCount + 1) {
    super(`${captureName} exceeded ${limitCount} entries`);
    this.name = "BenchmarkCollectionOverflowError";
    this.captureName = captureName;
    this.limitCount = limitCount;
    this.observedCountAtLeast = observedCountAtLeast;
  }
}
