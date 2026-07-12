/**
 * Butterfly Effect - Runtime
 *
 * - __wrapEffect: useEffectコールバックをラップしてeffectIdを管理
 * - Closure Binding: 非同期処理用（setterにeffectIdをバインド）
 */

import { EFFECT_ID_PREFIX } from "./constants.js";
import type {
	ButterflyEvent,
	ButterflyEventListener,
	StateUpdateData,
} from "./types.js";

// ============================================
// Event Emitter
// ============================================

class ButterflyEventEmitter {
	private listeners = new Set<ButterflyEventListener>();

	// リスナーを追加し、解除関数を返す
	on(listener: ButterflyEventListener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// イベントをリスナーに送信
	emit(event: ButterflyEvent) {
		this.listeners.forEach((listener) => {
			listener(event);
		});
	}

	// 全てのリスナーをクリア
	clear() {
		this.listeners.clear();
	}
}

export const ButterflyEvents = new ButterflyEventEmitter();

// ============================================
// Effect Context
// ============================================

// 現在のeffectId（同期処理用）
let currentEffectId: string | null = null;

// 更新カウンター
let updateCounter = 0;

/**
 * useEffectコールバックをラップし、同期実行中のみcurrentEffectIdを設定する
 */
export function __wrapEffect<T extends () => unknown>(
	effectId: string,
	fn: T,
): T {
	return (() => {
		currentEffectId = effectId;
		try {
			const cleanup = fn();
			// truthy判定にしないのは、asyncコールバックが返すPromiseを
			// cleanup扱いしてReactに渡すと、cleanup呼び出し時に
			// TypeErrorでクラッシュするため
			if (typeof cleanup === "function") {
				return () => {
					currentEffectId = effectId;
					try {
						(cleanup as () => void)();
					} finally {
						currentEffectId = null;
					}
				};
			}
			return undefined;
		} finally {
			currentEffectId = null;
		}
	}) as T;
}

/**
 * 現在のEffectIDを取得
 */
export function getCurrentEffectId(): string | null {
	return currentEffectId;
}

// ============================================
// State Tracking
// ============================================

// Setter ラッパーのキャッシュ（参照安定化用）
type SetterFn = (value: unknown) => void;
type WrappedSetterFn = (value: unknown, effectId?: unknown) => void;
const setterCache = new WeakMap<SetterFn, WrappedSetterFn>();

/**
 * useStateのsetterをラップする。WeakMapキャッシュを外さないのは、
 * レンダリングごとに新しいラッパーを返すとsetterを依存配列に入れた
 * effectが毎回発火してしまうため。
 *
 * effectIdの解決は2段構え:
 * 1. Closure BindingされたeffectId — currentEffectIdだけに頼らないのは
 *    await後の呼び出しで同期コンテキストが失われるため
 * 2. currentEffectIdへのフォールバック — バインドだけに頼らないのは
 *    effect外で定義されたコールバック（useMemo/useCallback等）経由の
 *    呼び出しには変換が届かないため
 *
 * どちらも無ければeffect外の呼び出しなのでイベントは発火しない。
 */
export function __wrapSetter(
	original: SetterFn,
	componentName: string,
	line: number,
): WrappedSetterFn {
	let wrapped = setterCache.get(original);
	if (!wrapped) {
		wrapped = (value: unknown, effectId?: unknown) => {
			// 型だけでなくEFFECT_ID_PREFIXまで検査するのは、setterが
			// forEach等へコールバックとして渡された場合に第2引数へ
			// index等の無関係な値が流れ込むため
			const resolvedEffectId =
				typeof effectId === "string" && effectId.startsWith(EFFECT_ID_PREFIX)
					? effectId
					: getCurrentEffectId();
			if (resolvedEffectId !== null) {
				__trackStateUpdate({
					componentName,
					line,
					timestamp: Date.now(),
					effectId: resolvedEffectId,
				});
			}
			return original(value);
		};
		setterCache.set(original, wrapped);
	}
	return wrapped;
}

/**
 * State更新を追跡
 */
export function __trackStateUpdate(data: StateUpdateData): void {
	const event = {
		id: `state-${Date.now()}-${updateCounter++}`,
		componentName: data.componentName,
		line: data.line,
		timestamp: data.timestamp,
		effectId: data.effectId,
	};

	ButterflyEvents.emit(event);
}
