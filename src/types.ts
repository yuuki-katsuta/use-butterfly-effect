export interface ButterflyEffectOptions {
	enabled?: boolean;
	theme?: string;
	showStatus?: boolean;
	animationSpeed?: number;
	maxButterflies?: number;
	trackEffect?: boolean;
	trackState?: boolean;
}

export interface StateUpdateData {
	componentName: string;
	line: number;
	timestamp: number;
	effectId: string;
	stateId: string;
	depth: number;
}

/** effect実行時に変化していた依存 */
export interface ChangedDep {
	name: string;
	index: number;
	prevPreview: string;
	nextPreview: string;
	/** 依存元のuseStateが特定できた場合のID（State_App_Line4形式） */
	stateId: string | null;
	/** プレビューが同一なのに参照が変わった疑い（メモ化漏れの典型） */
	sameValueNewRef: boolean;
}

export interface StateUpdateEvent {
	kind: "state-update";
	id: string;
	componentName: string;
	line: number;
	timestamp: number;
	effectId: string;
	stateId: string;
	/** カスケード深度。handler直=0起点、effect連鎖ごとに+1 */
	depth: number;
}

export interface EffectRunEvent {
	kind: "effect-run";
	id: string;
	effectId: string;
	timestamp: number;
	isFirstRun: boolean;
	depth: number;
	/** null = deps情報なし（初回実行・deps未指定・非配列リテラル） */
	changedDeps: ChangedDep[] | null;
	/** このeffectを発火させたstateを最後に書いたeffect。null = handler等の外部起点 */
	causeEffectId: string | null;
	/** 発火の引き金になったstate（特定できた場合） */
	causeStateId: string | null;
}

export interface StormEvent {
	kind: "storm";
	id: string;
	timestamp: number;
	/** 循環しているeffectの列。cycle[i]がcycle[i+1]を発火させ、
	 *  末尾が先頭を発火させて一周する */
	cycle: string[];
	depth: number;
}

export type ButterflyEvent = StateUpdateEvent | EffectRunEvent | StormEvent;

export type ButterflyEventListener = (event: ButterflyEvent) => void;

export interface Recording {
	startedAt: number;
	stoppedAt: number;
	/** 録画中に観測した全イベント（上限超過時は古い方から破棄） */
	events: ButterflyEvent[];
	/** バッファ上限による取りこぼしがあったか */
	truncated: boolean;
}

export type Butterfly = {
	id: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	targetX: number;
	targetY: number;
	heading: number;
	flapPhase: number;
	flapSpeed: number;
	speed: number;
	size: number;
	hue: number;
	depth: number;
	opacity: number;
	life: number;
	maxLife: number;
	wanderSeed: number;
};
