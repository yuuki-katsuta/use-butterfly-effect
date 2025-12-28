/**
 * Butterfly Effect - Runtime
 *
 * - __wrapEffect: useEffectコールバックをラップしてeffectIdを管理
 * - Closure Binding: 非同期処理用（setterにeffectIdをバインド）
 */

import type {
	ButterflyEvent,
	ButterflyEventListener,
	StateUpdateData,
} from "./types";

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
 * useEffectコールバックをラップ
 * 同期処理中のみcurrentEffectIdを設定
 */
export function __wrapEffect<T extends () => () => void>(
	effectId: string,
	fn: T,
): T {
	return (() => {
		currentEffectId = effectId;
		try {
			const cleanup = fn();
			if (cleanup) {
				return () => {
					currentEffectId = effectId;
					try {
						cleanup();
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
type WrappedSetterFn = (value: unknown, effectId: string) => void;
const setterCache = new WeakMap<SetterFn, WrappedSetterFn>();

/**
 * useState の setter をラップ（WeakMap でキャッシュして参照を安定化）
 */
export function __wrapSetter(
	original: SetterFn,
	componentName: string,
	line: number,
): WrappedSetterFn {
	let wrapped = setterCache.get(original);
	if (!wrapped) {
		wrapped = (value: unknown, effectId: string) => {
			__trackStateUpdate({
				componentName,
				line,
				timestamp: Date.now(),
				effectId,
			});
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
