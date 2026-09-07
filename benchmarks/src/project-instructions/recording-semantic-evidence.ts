type SemanticCapture = { partial?: boolean };
type CaptureOverflow = { captureName?: string; kind?: string };

export function semanticCaptureIsPartial(
  recordingCapture: SemanticCapture | undefined,
  captureOverflow: CaptureOverflow | undefined,
): boolean {
  if (recordingCapture?.partial === true) return true;
  const relevantOverflow = ["raw recording", "recording storage", "recording archive"].includes(
    captureOverflow?.captureName ?? "",
  );
  return captureOverflow?.kind === "capture_overflow" && (relevantOverflow || recordingCapture === undefined);
}
