import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
	test: {
		environment: "happy-dom",
		globals: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
		},
	},
	resolve: {
		alias: {
			"vite-plugin-butterfly-effect/runtime": path.resolve(
				__dirname,
				"src/runtime.ts",
			),
			"vite-plugin-butterfly-effect/overlay": path.resolve(
				__dirname,
				"src/overlay.ts",
			),
		},
	},
});
