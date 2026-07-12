import type { Plugin } from "vite";
import { OVERLAY_MODULE, RUNTIME_MODULE } from "./constants.js";
import { transformReactCode } from "./transform.js";
import type { ButterflyEffectOptions } from "./types.js";

const PLUGIN_NAME = "vite-plugin-butterfly-effect";
const OVERLAY_PATH = "/@butterfly-effect-overlay";
const OVERLAY_VIRTUAL_ID = "\0butterfly-effect-overlay";

export default function butterflyEffect(
	options: ButterflyEffectOptions = {},
): Plugin {
	const {
		enabled = true,
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
			apply: "serve",
		};
	}

	const overlayOptions = {
		theme,
		showStatus,
		animationSpeed,
		maxButterflies,
		trackEffect,
		trackState,
	};

	return {
		name: PLUGIN_NAME,
		// enabledオプションだけに任せないのは、NODE_ENVの外部設定次第で
		// 計測コードとオーバーレイが本番ビルドに混入してしまうため
		apply: "serve",
		config() {
			// transformで注入するimportは初期スキャンに載らず、Viteが
			// 依存を再発見してリバンドル+ページリロードを繰り返すため、
			// 事前にオプティマイザへ登録しておく
			return {
				optimizeDeps: {
					include: [RUNTIME_MODULE, OVERLAY_MODULE],
				},
			};
		},
		resolveId(id) {
			if (id === OVERLAY_PATH) {
				return OVERLAY_VIRTUAL_ID;
			}
		},
		load(id) {
			if (id === OVERLAY_VIRTUAL_ID) {
				return `
					import { initOverlay } from ${JSON.stringify(OVERLAY_MODULE)};

					initOverlay(${JSON.stringify(overlayOptions)});
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
			if (id.includes("/node_modules/") || id.startsWith("\0")) {
				return null;
			}
			// idには ?v= や ?t= 等のクエリが付くことがあり、
			// 拡張子を末尾一致で判定するとそれらを取りこぼす
			const cleanId = id.split("?", 1)[0];
			if (!/\.[jt]sx?$/.test(cleanId)) {
				return null;
			}

			try {
				return transformReactCode(code, id, {
					trackEffect,
					trackState,
				});
			} catch (error) {
				console.error(`[${PLUGIN_NAME}] Error transforming ${id}:`, error);
				return null;
			}
		},
	};
}

export { butterflyEffect };
