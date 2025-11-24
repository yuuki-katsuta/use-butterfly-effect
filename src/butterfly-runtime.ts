/**
 * Butterfly Effect
 *
 * 非同期処理の場合でもuseEffectのコンテキストを追跡する
 * 非同期処理（Promise/setTimeout）をまたいで、タグ（effectID）を維持する仕組み
 * setterが呼ばれた瞬間、コンテキストに「有効なEffect ID」が存在すればバタフライを生成
 */

import { ButterflyEvents } from "./runtime";
import type { StateUpdateData } from "./types";

// コンテキストスタック（ネストしたuseEffectに対応）
const contextStack: string[] = [];

// 更新カウンター
let updateCounter = 0;

// 各effectIdごとの未完了Promise数を追跡
const pendingPromises = new Map<string, number>();

export const ButterflyContext = {
	/**
	 * useEffectの先頭で実行
	 *
	 * @param effectId - Effect識別子（例: "Effect_App_Line42"）
	 */
	enter(effectId: string): void {
		contextStack.push(effectId);
	},

	/**
	 * cleanup関数で実行
	 */
	exit(): void {
		contextStack.pop();
	},

	/**
	 * Promise開始時に呼ばれる
	 */
	trackPromiseStart(effectId: string): void {
		const current = pendingPromises.get(effectId) || 0;
		pendingPromises.set(effectId, current + 1);
	},

	/**
	 * Promise完了時に呼ばれる
	 */
	trackPromiseEnd(effectId: string): void {
		const current = pendingPromises.get(effectId) || 0;
		if (current > 0) {
			const newCount = current - 1;
			pendingPromises.set(effectId, newCount);

			// 全てのPromiseが完了したらクリア
			if (newCount === 0) {
				pendingPromises.delete(effectId);
				// コンテキストスタックから該当effectIdを削除
				const index = contextStack.indexOf(effectId);
				if (index !== -1) {
					contextStack.splice(index, 1);
				}
			}
		}
	},

	/**
	 * 未完了のPromiseがあるかチェック
	 */
	hasPendingPromises(effectId: string): boolean {
		return (pendingPromises.get(effectId) || 0) > 0;
	},

	/**
	 * 同期実行完了後にコンテキストを一時的にクリア
	 *
	 * useEffectの同期部分が完了した後、非同期処理が始まる前に一時的にコンテキストをクリアします。
	 * これにより、useEffect内で呼ばれた関数が他の同期処理（イベントハンドラなど）をトリガーした場合に、誤ってトラッキングされることを防ぐ
	 *
	 * 非同期処理（Promise, setTimeout等）は、パッチによりコンテキストが自動的に復元される。
	 */
	clearSync(): void {
		const effectId = this.getCurrentEffectId();
		if (!effectId) return;

		// 未完了のPromiseがある場合はクリアしない
		if (this.hasPendingPromises(effectId)) {
			return;
		}

		// 未完了のPromiseがない場合のみクリア
		if (contextStack.length > 0) {
			contextStack.pop();
		}
	},

	/**
	 * 現在のEffectIDを取得（setState直前で呼ぶ）
	 *
	 * @returns effectId or null（カオス圏外の場合）
	 */
	getCurrentEffectId(): string | null {
		return contextStack[contextStack.length - 1] || null;
	},

	/**
	 * 非同期関数をラップしてコンテキストを維持
	 * Promise.thenやsetTimeoutのコールバックに使用される
	 *
	 * @param fn - ラップする関数
	 * @returns コンテキストを維持するラッパー関数
	 */
	wrapAsync<T extends (...args: any[]) => any>(fn: T): T {
		const capturedId = this.getCurrentEffectId();
		return ((...args: any[]) => {
			if (capturedId) contextStack.push(capturedId);
			try {
				return fn(...args);
			} finally {
				if (capturedId) contextStack.pop();
			}
		}) as T;
	},

	/**
	 * state更新を追跡（setState直前で呼ぶ）
	 * useEffect実行中またはその非同期処理中であればバタフライイベントを発火
	 *
	 * @param data - state更新のメタデータ
	 */
	trackStateUpdate(data: StateUpdateData): void {
		const effectId = this.getCurrentEffectId();
		if (!effectId) return; // カオス圏外なら追跡しない

		const event = {
			id: `state-${Date.now()}-${updateCounter++}`,
			componentName: data.componentName,
			line: data.line,
			timestamp: data.timestamp,
			effectId, // どのeffectから発生したか
		};

		ButterflyEvents.emit(event);
	},
};

/**
 * ==========================================
 *  Monkey Patching
 * ==========================================
 *
 * 非同期APIにパッチを適用してコンテキストを自動的に伝播させる
 *
 * ## パッチ対象
 * - Promise.prototype.then/finally
 * - window.setTimeout
 *
 * ## 仕組み
 * 各APIが呼ばれた瞬間のeffectIDをキャプチャし、
 * コールバック実行時にそのIDを復元することでコンテキストを維持する
 *
 * ## 将来的に追加を検討すべきAPI
 * - setInterval: 定期実行処理（ポーリング等）で使用される
 *  - 注意点: 長時間実行されるため、cleanup時の扱いが複雑
 *  - 実装例: window.setTimeoutと同様のパターンで実装可能
 *
 * - requestAnimationFrame: アニメーション処理で使用される
 *  - 注意点: 通常React内ではuseEffectで管理されることが少ない
 *  - 実装例: setTimeoutと同様のパターンで実装可能
 *
 * - queueMicrotask: マイクロタスクのスケジューリング
 *  - 注意点: 現在は内部で使用しているため、パッチすると循環参照の可能性
 *  - 実装時は注意が必要
 */

// 1. Promise.prototype.then
const originalThen = Promise.prototype.then;

// TypeScriptの型定義に合わせてジェネリクスと引数を定義
// biome-ignore lint/suspicious/noThenProperty: Intentional monkey-patch for async context tracking in dev mode
Promise.prototype.then = function <TResult1 = any, TResult2 = never>(
	onFulfilled?:
		| ((value: any) => TResult1 | PromiseLike<TResult1>)
		| null
		| undefined,
	onRejected?:
		| ((reason: any) => TResult2 | PromiseLike<TResult2>)
		| null
		| undefined,
): Promise<TResult1 | TResult2> {
	// コールバック関数をカプセル化
	const wrappedFulfilled = onFulfilled
		? ButterflyContext.wrapAsync(onFulfilled)
		: undefined;

	const wrappedRejected = onRejected
		? ButterflyContext.wrapAsync(onRejected)
		: undefined;

	return originalThen.call(this, wrappedFulfilled, wrappedRejected) as Promise<
		TResult1 | TResult2
	>;
};

// 2. Promise.prototype.finally
// finallyでの更新も追跡対象にする
const originalFinally = Promise.prototype.finally;
Promise.prototype.finally = function (onFinally) {
	const wrapped = onFinally ? ButterflyContext.wrapAsync(onFinally) : undefined;
	return originalFinally.call(this, wrapped);
};

// window.setTimeout
const originalSetTimeout = window.setTimeout;
window.setTimeout = ((
	handler: TimerHandler,
	timeout?: number,
	...args: any[]
): number => {
	if (typeof handler === "function") {
		const capturedEffectId = ButterflyContext.getCurrentEffectId();

		// effectId がある場合、Promise開始を追跡
		if (capturedEffectId) {
			ButterflyContext.trackPromiseStart(capturedEffectId);
		}

		const wrappedHandler = ButterflyContext.wrapAsync(
			(...handlerArgs: any[]) => {
				try {
					return (handler as (...args: any[]) => any)(...handlerArgs);
				} finally {
					// タイマー完了時に追跡を終了
					if (capturedEffectId) {
						ButterflyContext.trackPromiseEnd(capturedEffectId);
					}
				}
			},
		);
		return originalSetTimeout(wrappedHandler as TimerHandler, timeout, ...args);
	}
	return originalSetTimeout(handler, timeout, ...args);
}) as typeof setTimeout;
