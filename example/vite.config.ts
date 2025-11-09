import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import butterflyEffect from "../src/index.ts";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		butterflyEffect({
			enabled: true,
			showStats: true,
			animationSpeed: 1000,
			maxButterflies: 10,
		}),
	],
});
