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
let updateCounter = 0;

export function __trackStateUpdate(data: StateUpdateData) {
	const event: ButterflyEvent = {
		id: `state-${Date.now()}-${updateCounter++}`,
		componentName: data.componentName,
		filePath: "",
		line: data.line,
		column: 0,
		timestamp: data.timestamp,
		type: "state",
		nextValue: data.value,
	};

	// イベントを送信
	ButterflyEvents.emit(event);

	// HMR対応
	// if (import.meta.hot) {
	// 	import.meta.hot.send("butterfly:state-update", event);
	// }
}
