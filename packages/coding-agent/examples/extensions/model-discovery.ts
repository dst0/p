/**
 * Auto-discover models from OpenAI-compatible server endpoints (llama-server, vLLM, Ollama, etc.)
 *
 * Config:
 * - Set SERVERS env var: "mini-pc:11450,mini-pc:11451,mini-pc:11452"
 * - Or set SERVERS_JSON env var for JSON config:
 *   [{"host":"mini-pc","port":11450,"name":"mini-pc-11450","api":"openai-completions"}]
 * - Or place config in ~/.pi/agent/servers.json:
 *   {"servers":[{"host":"mini-pc","port":11450,"name":"mini-pc-11450"}]}
 */

interface ServerConfig {
	host: string;
	port: number;
	name?: string;
	api?: string;
	apiKey?: string;
	compat?: {
		supportsDeveloperRole?: boolean;
		supportsReasoningEffort?: boolean;
	};
}

interface ExtensionAPI {
	registerProvider(name: string, config: any): void;
}
async function loadServersConfig(): Promise<ServerConfig[]> {
	// Check env var first
	const serversJson = process.env.SERVERS_JSON;
	if (serversJson) {
		try {
			return JSON.parse(serversJson);
		} catch (e) {
			console.error("Failed to parse SERVERS_JSON:", e);
		}
	}

	// Check SERVERS env var (simple host:port format)
	const serversEnv = process.env.SERVERS;
	if (serversEnv) {
		const servers: ServerConfig[] = [];
		for (const entry of serversEnv
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s)) {
			const [host, port] = entry.split(":");
			if (host && port) {
				servers.push({
					host,
					port: parseInt(port, 10),
					name: `${host}-${port}`,
					api: "openai-completions",
				});
			}
		}
		if (servers.length > 0) return servers;
	}

	// Load from config file
	const homedir = require("node:os").homedir();
	const configPath = require("node:path").resolve(homedir, ".pi/agent/servers.json");
	try {
		const fs = require("node:fs/promises");
		const config = JSON.parse(await fs.readFile(configPath, "utf8"));
		return config.servers || [];
	} catch {
		return [];
	}
}

async function discoverModelsFromServer(server: ServerConfig): Promise<Array<{ id: string; name: string }>> {
	const baseUrl = `http://${server.host}:${server.port}`;
	const modelsUrl = `${baseUrl}/v1/models`;

	try {
		const response = await fetch(modelsUrl, {
			signal: AbortSignal.timeout(3000),
			headers: {
				Authorization: `Bearer ${server.apiKey || "ollama"}`,
			},
		});

		if (!response.ok) {
			console.error(`Failed to discover models from ${baseUrl}: ${response.status}`);
			return [];
		}

		const data = (await response.json()) as any;
		const models = data.data || [];
		return models.map((model: any) => ({
			id: model.id,
			name: model.name || model.id,
		}));
	} catch (error) {
		console.error(`Failed to connect to ${baseUrl}:`, error);
		return [];
	}
}

export default async function (pi: ExtensionAPI) {
	const servers = await loadServersConfig();

	if (servers.length === 0) {
		console.log("No servers configured for auto-discovery");
		return;
	}

	// Discover models from each server
	for (const server of servers) {
		const models = await discoverModelsFromServer(server);

		if (models.length === 0) {
			continue;
		}

		const providerName = server.name || `${server.host}-${server.port}`;
		const baseUrl = `http://${server.host}:${server.port}/v1`;

		pi.registerProvider(providerName, {
			name: `Local Server ${providerName}`,
			baseUrl,
			api: server.api || "openai-completions",
			apiKey: server.apiKey || "ollama",
			compat: server.compat,
			models: models.map((model) => ({
				id: model.id,
				name: model.name,
			})),
		});
	}
}
