/**
 * Butterfly Effect - Runtime
 *
 * - __wrapEffect: useEffectコールバックをラップしてeffectIdを管理
 * - __captureDeps: deps配列のパススルー記録（発火原因の特定用）
 * - Closure Binding: 非同期処理用（setterにeffectIdをバインド）
 */

import { EFFECT_ID_PREFIX } from "./constants.js";
import type {
	ButterflyEvent,
	ButterflyEventListener,
	ChangedDep,
	Recording,
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
// Recording
// ============================================

// 常時バッファリングにしないのは、録画していない間のオーバーヘッドを
// ゼロにするため。リスナーは録画中だけ登録する
const MAX_RECORDED_EVENTS = 10_000;

type ActiveRecording = {
	startedAt: number;
	/** 循環バッファ。shift()だと上限到達後の1イベント毎にO(n)かかる */
	buffer: (ButterflyEvent | undefined)[];
	head: number;
	total: number;
	off: () => void;
};

let activeRecording: ActiveRecording | null = null;

export function isRecording(): boolean {
	return activeRecording !== null;
}

export function startRecording(): void {
	if (activeRecording) return;

	const recording: ActiveRecording = {
		startedAt: Date.now(),
		buffer: new Array(MAX_RECORDED_EVENTS),
		head: 0,
		total: 0,
		off: () => {},
	};
	recording.off = ButterflyEvents.on((event) => {
		recording.buffer[recording.head] = event;
		recording.head = (recording.head + 1) % MAX_RECORDED_EVENTS;
		recording.total++;
	});
	activeRecording = recording;
}

export function stopRecording(): Recording | null {
	const recording = activeRecording;
	if (!recording) return null;

	recording.off();
	activeRecording = null;

	const truncated = recording.total > MAX_RECORDED_EVENTS;
	const events: ButterflyEvent[] = [];
	const count = Math.min(recording.total, MAX_RECORDED_EVENTS);
	const start = truncated ? recording.head : 0;
	for (let i = 0; i < count; i++) {
		const event = recording.buffer[(start + i) % MAX_RECORDED_EVENTS];
		if (event) events.push(event);
	}

	return {
		startedAt: recording.startedAt,
		stoppedAt: Date.now(),
		events,
		truncated,
	};
}

// ============================================
// Deps Capture（発火原因の特定）
// ============================================

type DepsCapture = {
	names: string[] | null;
	stateIds: (string | null)[] | null;
	/** 最新レンダーのdeps */
	pending: readonly unknown[] | undefined;
	/** 最後にeffectが実行された時点のdeps。Reactの比較対象は
	 *  「前回レンダー」ではなく「前回実行時」なので、レンダー毎ではなく
	 *  実行時にのみ更新する */
	lastRun: readonly unknown[] | undefined;
	hasLastRun: boolean;
};

export type InstanceStore = Record<string, DepsCapture>;

/**
 * deps配列を記録してそのまま返す。
 * 受け取った配列をそのまま返すことで、Reactのdeps比較のセマンティクスを
 * 一切変えない（変換前と同じ配列インスタンスがReactに渡る）
 */
export function __captureDeps(
	inst: InstanceStore | undefined,
	effectId: string,
	names: string[] | null,
	stateIds: (string | null)[] | null,
	values: unknown,
): unknown {
	if (inst) {
		const record = (inst[effectId] ??= {
			names,
			stateIds,
			pending: undefined,
			lastRun: undefined,
			hasLastRun: false,
		});
		record.names = names;
		record.stateIds = stateIds;
		record.pending = Array.isArray(values) ? values : undefined;
	}
	return values;
}

const previewValue = (value: unknown): string => {
	if (value === null) return "null";
	switch (typeof value) {
		case "undefined":
			return "undefined";
		case "function":
			return `ƒ ${(value as { name?: string }).name || "anonymous"}`;
		case "string":
			return value.length > 30 ? `"${value.slice(0, 30)}…"` : `"${value}"`;
		case "object": {
			if (Array.isArray(value)) return `Array(${value.length})`;
			// JSON.stringifyにしないのは、巨大なdepで全グラフを毎effect実行
			// ごとに直列化するコストと、getter/Proxyトラップの副作用を
			// 呼び出してしまうため。キー名の列挙に留める
			const keys = Object.keys(value);
			const head = keys.slice(0, 3).join(", ");
			return `{${head}${keys.length > 3 ? `, +${keys.length - 3}` : ""}}`;
		}
		default:
			return String(value);
	}
};

/**
 * 「値は同じに見えるのに参照が変わった」= メモ化漏れの検出。
 * プレビュー文字列の比較にしないのは、Array(3)同士のように中身が
 * 違っても表示が一致して誤検知するため。shallowに実値を比較する
 */
const isSameShallowValue = (prev: unknown, next: unknown): boolean => {
	if (typeof prev === "function" && typeof next === "function") {
		return (
			(prev as { name?: string }).name === (next as { name?: string }).name
		);
	}
	if (Array.isArray(prev) && Array.isArray(next)) {
		return (
			prev.length === next.length &&
			prev.every((item, i) => Object.is(item, next[i]))
		);
	}
	if (
		typeof prev === "object" &&
		typeof next === "object" &&
		prev !== null &&
		next !== null &&
		!Array.isArray(prev) &&
		!Array.isArray(next)
	) {
		const prevKeys = Object.keys(prev);
		const nextKeys = Object.keys(next);
		return (
			prevKeys.length === nextKeys.length &&
			prevKeys.every((key) =>
				Object.is(
					(prev as Record<string, unknown>)[key],
					(next as Record<string, unknown>)[key],
				),
			)
		);
	}
	return false;
};

const diffDeps = (record: DepsCapture): ChangedDep[] | null => {
	if (!record.hasLastRun || !record.pending || !record.lastRun) {
		return null;
	}

	const changed: ChangedDep[] = [];
	const length = Math.max(record.pending.length, record.lastRun.length);
	for (let i = 0; i < length; i++) {
		const prev = record.lastRun[i];
		const next = record.pending[i];
		if (Object.is(prev, next)) continue;

		changed.push({
			name: record.names?.[i] ?? `deps[${i}]`,
			index: i,
			prevPreview: previewValue(prev),
			nextPreview: previewValue(next),
			stateId: record.stateIds?.[i] ?? null,
			sameValueNewRef: isSameShallowValue(prev, next),
		});
	}
	return changed;
};

// ============================================
// Effect Context
// ============================================

// 現在のeffectId（同期処理用）
let currentEffectId: string | null = null;
let currentDepth = 0;

// 非同期（Closure Binding）経由の書き込みは同期コンテキストが失われる
// ため、effectId毎の最終実行深度から深度を復元する（同一effectIdの
// 複数インスタンスは近似になる）
const lastRunDepth = new Map<string, number>();

// state毎の最終書き込み元。effect発火の因果を遡るために、
// イベントにならない書き込み（handler等）も記録する
type LastWrite = { effectId: string | null; depth: number; at: number };
const lastWriteByState = new Map<string, LastWrite>();

// Date.now()は同一tick内で衝突するため、書き込み順序は単調カウンタで持つ
let writeClock = 0;

// 更新カウンター
let updateCounter = 0;

/**
 * useEffectコールバックをラップする。
 * 実行前にdeps差分から発火原因（どのdepが変わり、それを誰が書いたか）と
 * カスケード深度を解決し、effect-runイベントとして発行する
 */
export function __wrapEffect<T extends () => unknown>(
	effectId: string,
	fn: T,
	inst?: InstanceStore,
): T {
	return (() => {
		const record = inst?.[effectId];
		const isFirstRun = record ? !record.hasLastRun : false;
		const changedDeps = record ? diffDeps(record) : null;
		if (record) {
			record.lastRun = record.pending;
			record.hasLastRun = true;
		}

		let causeEffectId: string | null = null;
		let causeStateId: string | null = null;
		let depth = 0;
		if (changedDeps && changedDeps.length > 0) {
			// depsは変わったが書き込み元を特定できない場合も、
			// 外部起点の連鎖1段目として数える
			depth = 1;
			let latest = -1;
			for (const dep of changedDeps) {
				if (!dep.stateId) continue;
				const write = lastWriteByState.get(dep.stateId);
				if (write && write.at > latest) {
					latest = write.at;
					causeEffectId = write.effectId;
					causeStateId = dep.stateId;
					depth = write.depth + 1;
				}
			}
		}

		ButterflyEvents.emit({
			kind: "effect-run",
			id: `effect-${Date.now()}-${updateCounter++}`,
			effectId,
			timestamp: Date.now(),
			isFirstRun,
			depth,
			changedDeps,
			causeEffectId,
			causeStateId,
		});

		lastRunDepth.set(effectId, depth);
		currentEffectId = effectId;
		currentDepth = depth;
		try {
			const cleanup = fn();
			// truthy判定にしないのは、asyncコールバックが返すPromiseを
			// cleanup扱いしてReactに渡すと、cleanup呼び出し時に
			// TypeErrorでクラッシュするため
			if (typeof cleanup === "function") {
				return () => {
					currentEffectId = effectId;
					currentDepth = lastRunDepth.get(effectId) ?? 0;
					try {
						(cleanup as () => void)();
					} finally {
						currentEffectId = null;
						currentDepth = 0;
					}
				};
			}
			return undefined;
		} finally {
			currentEffectId = null;
			currentDepth = 0;
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
 * どちらも無ければeffect外の呼び出しなのでイベントは発火しないが、
 * 因果追跡のため書き込み記録（lastWriteByState）だけは残す
 */
export function __wrapSetter(
	original: SetterFn,
	componentName: string,
	line: number,
	// 変換側が合成した衝突耐性のあるID。名前+行だけだと別ファイルの
	// 同名コンポーネント・同一行と混線して偽の因果が繋がる
	stateIdOverride?: string,
): WrappedSetterFn {
	let wrapped = setterCache.get(original);
	if (!wrapped) {
		const stateId = stateIdOverride ?? `State_${componentName}_Line${line}`;
		wrapped = (value: unknown, effectId?: unknown) => {
			// 型だけでなくEFFECT_ID_PREFIXまで検査するのは、setterが
			// forEach等へコールバックとして渡された場合に第2引数へ
			// index等の無関係な値が流れ込むため
			const boundEffectId =
				typeof effectId === "string" && effectId.startsWith(EFFECT_ID_PREFIX)
					? effectId
					: null;
			const resolvedEffectId = boundEffectId ?? getCurrentEffectId();
			const depth =
				resolvedEffectId === null
					? 0
					: resolvedEffectId === currentEffectId
						? currentDepth
						: (lastRunDepth.get(resolvedEffectId) ?? 0);

			lastWriteByState.set(stateId, {
				effectId: resolvedEffectId,
				depth,
				at: ++writeClock,
			});

			if (resolvedEffectId !== null) {
				__trackStateUpdate({
					componentName,
					line,
					timestamp: Date.now(),
					effectId: resolvedEffectId,
					stateId,
					depth,
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
	ButterflyEvents.emit({
		kind: "state-update",
		id: `state-${Date.now()}-${updateCounter++}`,
		componentName: data.componentName,
		line: data.line,
		timestamp: data.timestamp,
		effectId: data.effectId,
		stateId: data.stateId,
		depth: data.depth,
	});
}
