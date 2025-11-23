import { defineConfig } from "rolldown";

export default defineConfig({
	input: {
		index: "src/index.ts",
		overlay: "src/overlay.ts",
		runtime: "src/runtime.ts",
	},
	output: {
		dir: "dist",
		format: "esm",
		entryFileNames: "[name].js",
		sourcemap: true,
	},
	external: [
		"@babel/parser",
		"@babel/traverse",
		"@babel/types",
		"@babel/generator",
	],
});
