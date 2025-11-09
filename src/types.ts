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
	value: unknown;
}

export interface ButterflyEvent {
	id: string;
	componentName: string;
	filePath: string;
	line: number;
	column: number;
	timestamp: number;
	type: "state" | "effect";
	nextValue?: unknown;
}
