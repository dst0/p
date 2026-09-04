export const QDRANT_VERSION = "1.18.3";

const QDRANT_ASSETS = {
	"darwin-arm64": {
		name: "qdrant-aarch64-apple-darwin.tar.gz",
		sha256: "0cb040a261035c316779bd7b4cca2e6ab39faf62640d6918bbbe320e2a9a6547",
	},
	"darwin-x64": {
		name: "qdrant-x86_64-apple-darwin.tar.gz",
		sha256: "45bdd4642e7f25611e9cd74f9f91482b27c5376840cd8dc476da67b87abe25a6",
	},
	"linux-arm64": {
		name: "qdrant-aarch64-unknown-linux-musl.tar.gz",
		sha256: "1e738b45f90935c383b4076c30f377f390964cb5962b5bff24439812d157dc24",
	},
	"linux-x64": {
		name: "qdrant-x86_64-unknown-linux-musl.tar.gz",
		sha256: "b4faedcdf8c957bf1c8f2ab9b454636b87e056c116c99d49bd4f9fb2e634285",
	},
};

export function getQdrantAsset(platform = process.platform, architecture = process.arch) {
	return QDRANT_ASSETS[`${platform}-${architecture}`];
}

export function getQdrantExtractionArgs(archive, destination) {
	return ["-xzf", archive, "--no-same-owner", "-C", destination];
}
