import type { Plugin } from "rolldown";
import { transformReactCode } from "./transform.js";
import type { ButterflyEffectOptions } from "./types";

const PLUGIN_NAME = "vite-plugin-butterfly-effect";
const OVERLAY_ENTRY_ID = "\0butterfly-effect-overlay";

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

	// プロジェクトルートを取得
	const projectRoot = process.cwd();

	return {
		name: PLUGIN_NAME,
		resolveId(id) {
			if (id === OVERLAY_ENTRY_ID) {
				return id;
			}
		},
		load(id) {
			if (id === OVERLAY_ENTRY_ID) {
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
		transform(code, id) {
			// main.tsx または main.ts に対してオーバーレイ初期化コードを注入
			if (id.match(/\/main\.(ts|tsx|js|jsx)$/)) {
				return {
					code: `import '${OVERLAY_ENTRY_ID}';\n${code}`,
					map: null,
				};
			}

			// 対象外ファイルはスキップ
			if (!id.match(/\.(jsx|tsx|ts|js)$/)) {
				return null;
			}

			// React コードを変換
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
