import { ButterflyContext } from "./butterfly-runtime";
import type {
	ButterflyEvent,
	ButterflyEventListener,
	StateUpdateData,
} from "./types";

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
export { ButterflyContext };

/**
 * State更新を追跡
 * useEffect内からの呼び出しを検知
 */
export function __trackStateUpdate(data: StateUpdateData) {
	ButterflyContext.trackStateUpdate(data);
}
