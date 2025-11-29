import path from "node:path";
import react from "@vitejs/plugin-react";
import type { PluginOption } from "vite";
import { defineConfig } from "vite";
import butterflyEffect from "../../dist/index.js";

export default defineConfig({
	root: __dirname,
	plugins: [
		react(),
		butterflyEffect({
			enabled: true,
			showStatus: true,
			animationSpeed: 1000,
			maxButterflies: 100,
		}) as PluginOption,
	],
	resolve: {
		alias: {
			"vite-plugin-butterfly-effect/runtime": path.resolve(
				__dirname,
				"../../dist/runtime.js",
			),
			"vite-plugin-butterfly-effect/overlay": path.resolve(
				__dirname,
				"../../dist/overlay.js",
			),
		},
	},
	server: {
		port: 5174,
	},
});
