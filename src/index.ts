import type { Plugin } from "vite";
import { transformReactCode } from "./transform.js";
import type { ButterflyEffectOptions } from "./types";

const PLUGIN_NAME = "vite-plugin-butterfly-effect";
const OVERLAY_PATH = "/@butterfly-effect-overlay";
const OVERLAY_VIRTUAL_ID = "\0butterfly-effect-overlay";

export default function butterflyEffect(
	options: ButterflyEffectOptions = {},
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
		};
	}

	const projectRoot = process.cwd();

	return {
		name: PLUGIN_NAME,
		resolveId(id) {
			if (id === OVERLAY_PATH) {
				return OVERLAY_VIRTUAL_ID;
			}
		},
		load(id) {
			if (id === OVERLAY_VIRTUAL_ID) {
				return `
					import { initOverlay } from 'vite-plugin-butterfly-effect/overlay';

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
		transformIndexHtml() {
			return [
				{
					tag: "script",
					attrs: { type: "module", src: OVERLAY_PATH },
					injectTo: "head",
				},
			];
		},
		transform(code, id) {
			// 対象外ファイルはスキップ
			if (!id.match(/\.(jsx|tsx|ts|js)$/)) {
				return null;
			}

			try {
				const result = transformReactCode(code, id, projectRoot, {
					trackEffect,
					trackState,
				});

				return result;
			} catch (error) {
				console.error(`[${PLUGIN_NAME}] Error transforming ${id}:`, error);
				return null;
			}
		},
	};
}

export { butterflyEffect };
