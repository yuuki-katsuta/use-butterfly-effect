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
	value?: unknown;
	effectId: string;
}

export interface ButterflyEvent {
	id: string;
	componentName: string;
	line: number;
	timestamp: number;
	effectId: string;
}

export type ButterflyEventListener = (event: ButterflyEvent) => void;

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
	opacity: number;
	life: number;
	maxLife: number;
	wanderSeed: number;
};
