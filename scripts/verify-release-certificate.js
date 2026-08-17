#!/usr/bin/env node

import { verifyReleaseReceipt } from "./release-certificate-receipt.js";

const tagName = process.argv[2];
if (!tagName) {
  console.error("Usage: node scripts/verify-release-certificate.js <vX.Y.Z>");
  process.exit(1);
}

try {
  const result = verifyReleaseReceipt(process.cwd(), tagName);
  console.log(`Verified release certificate ${result.receipt.certificateId} for ${tagName}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
