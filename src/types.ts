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
}

export type ButterflyEventListener = (event: ButterflyEvent) => void;

export type Butterfly = {
	id: string;
	x: number;
	y: number;
	targetX: number;
	targetY: number;
	angle: number;
	speed: number;
	size: number;
	color: string;
	opacity: number;
	life: number;
	maxLife: number;
};
