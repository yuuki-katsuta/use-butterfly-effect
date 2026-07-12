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
			animationSpeed: 4000,
			maxButterflies: 100,
		}) as PluginOption,
	],
	optimizeDeps: {
		// file:リンク開発ではdist再ビルドが最適化キャッシュに反映されない
		// (キャッシュはlockfile変更でしか無効化されない)ため、プラグインが
		// 登録するincludeをここで打ち消し、常にdistの実体を配信させる
		exclude: [
			"vite-plugin-butterfly-effect/runtime",
			"vite-plugin-butterfly-effect/overlay",
		],
	},
});
