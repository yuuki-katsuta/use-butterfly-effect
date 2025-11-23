import react from "@vitejs/plugin-react";
import type { PluginOption } from "vite";
import { defineConfig } from "vite";
import butterflyEffect from "../dist/index.js";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		butterflyEffect({
			enabled: true,
			showStatus: true,
			animationSpeed: 1000,
			maxButterflies: 100,
		}) as PluginOption,
	],
});
