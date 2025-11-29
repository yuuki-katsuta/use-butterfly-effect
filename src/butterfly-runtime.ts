/**
 * Butterfly Effect - Runtime Context
 *
 * - __wrapEffect: useEffectコールバックをラップしてeffectIdを管理
 * - Closure Binding: 非同期処理用（setterにeffectIdをバインド）
 */

import { ButterflyEvents } from "./runtime";
import type { StateUpdateData } from "./types";

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

/**
 * state更新を追跡
 * - Closure BindingでeffectIdが渡された場合はそれを使用
 * - 渡されなかった場合はcurrentEffectIdからフォールバック
 */
export function trackStateUpdate(data: StateUpdateData): void {
	const effectId = data.effectId ?? currentEffectId;

	if (!effectId) return;

	const event = {
		id: `state-${Date.now()}-${updateCounter++}`,
		componentName: data.componentName,
		line: data.line,
		timestamp: data.timestamp,
		effectId,
	};

	ButterflyEvents.emit(event);
}
