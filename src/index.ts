import type { Plugin } from "vite";
import type { ButterflyEffectOptions } from "./types";

const PLUGIN_NAME = "vite-plugin-butterfly-effect";
const RUNTIME_ENTRY_ID = "\0butterfly-effect-runtime";

export default function butterflyEffect(
	options: ButterflyEffectOptions,
): Plugin {
	const {
		enabled = process.env.NODE_ENV === "development",
		theme = "default",
		showStatus = false,
		animationSpeed = 1000,
		maxButterflies = 10,
		trackEffect = true,
		trackState = true,
	} = options;

	if (!enabled) {
		return {
			name: PLUGIN_NAME,
			enforce: "pre",
		};
	}

	return {
		name: PLUGIN_NAME,
		enforce: "pre",

		// Vite の依存関係の事前バンドル（pre-bundling）からプラグインを除外する
		config() {
			return {
				optimizeDeps: {
					exclude: ["vite-plugin-butterfly-effect"],
				},
			};
		},
		// モジュールの解決
		resolveId(id) {
			if (id === RUNTIME_ENTRY_ID) {
				return id;
			}
		},
		// モジュールの中身を提供
		load(id) {
			if (id === RUNTIME_ENTRY_ID) {
				return `
          import { initOverlay } from './initOverlay.ts';

          initOverlay({
            theme: '${theme}',
            showStatus: ${showStatus},
            animationSpeed: ${animationSpeed},
            maxButterflies: ${maxButterflies},
            trackEffect: ${trackEffect},
            trackState: ${trackState},
          });
        `;
			}
		},
	};
}

export { butterflyEffect };
