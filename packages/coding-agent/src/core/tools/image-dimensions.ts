export interface ParsedRatio {
  width: number;
  height: number;
  ratio: number;
}

export function parseAspectRatio(aspectRatio?: string): ParsedRatio | undefined {
  if (!aspectRatio) return undefined;
  const trimmed = aspectRatio.trim();
  const sepMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*[:/x×*]\s*(\d+(?:\.\d+)?)$/i);
  if (sepMatch) {
    const w = parseFloat(sepMatch[1]);
    const h = parseFloat(sepMatch[2]);
    if (w > 0 && h > 0) {
      return { width: w, height: h, ratio: w / h };
    }
  }

  const singleNum = parseFloat(trimmed);
  if (!Number.isNaN(singleNum) && singleNum > 0 && /^\d+(?:\.\d+)?$/.test(trimmed)) {
    return { width: singleNum, height: 1, ratio: singleNum };
  }

  throw new Error(`Invalid aspectRatio format "${aspectRatio}". Expected format like "16:9", "4:3", "1:1", or "1.5"`);
}

export function parseSize(size?: string): ParsedRatio | undefined {
  if (!size) return undefined;
  const match = size.trim().match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
  if (match) {
    const w = parseInt(match[1], 10);
    const h = parseInt(match[2], 10);
    if (w > 0 && h > 0) {
      return { width: w, height: h, ratio: w / h };
    }
  }
  return undefined;
}

const COMMON_RATIO_PRESETS: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "1792x1024",
  "9:16": "1024x1792",
  "4:3": "1024x768",
  "3:4": "768x1024",
  "3:2": "1200x800",
  "2:3": "800x1200",
  "21:9": "1792x768",
};

export function resolveAspectRatio(aspectRatio?: string): string | undefined {
  if (!aspectRatio) return undefined;
  const normalized = aspectRatio.trim();
  if (COMMON_RATIO_PRESETS[normalized]) {
    return COMMON_RATIO_PRESETS[normalized];
  }
  const parsed = parseAspectRatio(aspectRatio);
  if (!parsed) return undefined;

  const targetPixels = 1024 * 1024;
  const rawW = Math.sqrt(targetPixels * parsed.ratio);
  const rawH = Math.sqrt(targetPixels / parsed.ratio);
  const roundedW = Math.max(64, Math.round(rawW / 16) * 16);
  const roundedH = Math.max(64, Math.round(rawH / 16) * 16);
  return `${roundedW}x${roundedH}`;
}

export function resolveDimensions(size?: string, aspectRatio?: string): string | undefined {
  if (size && aspectRatio) {
    const parsedRatio = parseAspectRatio(aspectRatio);
    const parsedSize = parseSize(size);

    if (parsedRatio && parsedSize) {
      const diff = Math.abs(parsedSize.ratio - parsedRatio.ratio) / parsedRatio.ratio;
      // Allow up to 10% tolerance for standard display and integer pixel rounding
      if (diff > 0.1) {
        throw new Error(
          `Conflicting size ("${size}", ratio ${parsedSize.ratio.toFixed(2)}) and aspectRatio ("${aspectRatio}", ratio ${parsedRatio.ratio.toFixed(2)}) specified`,
        );
      }
    }
    return size;
  }

  if (size) return size;
  return resolveAspectRatio(aspectRatio);
}
