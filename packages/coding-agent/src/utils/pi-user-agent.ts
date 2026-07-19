export function getPiUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `p/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}
