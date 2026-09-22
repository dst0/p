export function formatCertificationReport(outcome: { passed: boolean; failures: readonly string[] }): string {
  let section = "## Certification Results\n\n";
  if (outcome.passed) {
    section += "**Result: PASSED**\n\nAll certification requirements and baseline comparison thresholds met.\n\n";
  } else {
    section += "**Result: FAILED**\n\nCertification failed closed on the following requirements:\n\n";
    for (const failure of outcome.failures) section += `- ${failure}\n`;
    section += "\n";
  }
  return section;
}
