import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		overlay: "src/overlay.ts",
		runtime: "src/runtime.ts",
	},
	format: "esm",
	dts: false,
	sourcemap: true,
	clean: true,
});
