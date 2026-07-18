import { createNoise2D } from "simplex-noise";
import {
	ButterflyEvents,
	isRecording,
	startRecording,
	stopRecording,
} from "./runtime.js";
import type {
	Butterfly,
	ButterflyEffectOptions,
	ButterflyEvent,
	Recording,
	StateUpdateEvent,
} from "./types.js";

const TWO_PI = Math.PI * 2;

const lerpAngle = (from: number, to: number, t: number): number => {
	let diff = (to - from) % TWO_PI;
	if (diff > Math.PI) diff -= TWO_PI;
	if (diff < -Math.PI) diff += TWO_PI;
	return from + diff * t;
};

class ButterflyCanvas {
	private options: ButterflyEffectOptions;
	private butterflies: Butterfly[] = [];
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private noise2D = createNoise2D();
	private running = false;
	private idleFrames = 0;
	private stormUntil = 0;

	constructor(container: HTMLElement, options: ButterflyEffectOptions) {
		this.options = options;

		this.canvas = document.createElement("canvas");
		this.canvas.style.cssText = "width: 100%; height: 100%; display: block;";
		container.appendChild(this.canvas);

		// biome-ignore lint/style/noNonNullAssertion: canvas要素の2Dコンテキストは必ず取得できる
		this.ctx = this.canvas.getContext("2d")!;
		this.resize();

		window.addEventListener("resize", () => this.resize());
	}

	private get width() {
		return window.innerWidth;
	}

	private get height() {
		return window.innerHeight;
	}

	resize() {
		const dpr = window.devicePixelRatio || 1;
		this.canvas.width = this.width * dpr;
		this.canvas.height = this.height * dpr;
		// 以降の描画をCSSピクセル座標で書けるよう、DPRはtransformで吸収する。
		// これをしないとRetina環境で蝶がぼやける
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	/** 蝶の数に対する飽和度。色相・羽ばたき・軌跡・ビネットの強度を駆動する。
	 *  ストーム検出中は蝶の数に関係なく最大まで振り切る */
	private chaosLevel(): number {
		if (Date.now() < this.stormUntil) {
			return 1;
		}
		const max = Math.max(1, this.options.maxButterflies || 10);
		return Math.min(1, this.butterflies.length / max);
	}

	triggerStorm() {
		this.stormUntil = Date.now() + 4000;
		this.start();
	}

	createButterfly(event: StateUpdateEvent) {
		if (this.butterflies.length >= (this.options?.maxButterflies || 0)) {
			this.butterflies.shift();
		}

		const { x, y } = this.pickSpawnPoint();
		const { x: targetX, y: targetY } = this.pickTargetPoint();
		const depth = Math.max(0, event.depth);

		const butterfly: Butterfly = {
			id: event.id,
			x,
			y,
			vx: 0,
			vy: 0,
			targetX,
			targetY,
			heading: Math.atan2(targetY - y, targetX - x),
			flapPhase: Math.random() * TWO_PI,
			// モルフォは大きな翅でゆったり羽ばたく。速いとセセリチョウになる
			flapSpeed: 0.16 + Math.random() * 0.1,
			speed: 2.2 + Math.random() * 2,
			// 連鎖の深い羽ばたきほど大きく描き、嵐の芽を目立たせる
			size: (16 + Math.random() * 12) * (1 + Math.min(depth, 5) * 0.12),
			hue: this.getBaseHue(event.componentName),
			depth,
			opacity: 0,
			life: 0,
			maxLife: (this.options?.animationSpeed || 1000) / 16,
			wanderSeed: Math.random() * 1000,
		};

		this.butterflies.push(butterfly);
		this.updateActiveButterflyCount();
		this.start();
	}

	private pickSpawnPoint() {
		const rightAreaStartX = this.width * 0.5;
		const bottomAreaStartY = this.height * 0.4;
		const edge = Math.random();

		if (edge < 0.3) {
			return {
				x: rightAreaStartX + Math.random() * (this.width - rightAreaStartX),
				y: this.height + 40,
			};
		}
		if (edge < 0.6) {
			return {
				x: this.width + 40,
				y: bottomAreaStartY + Math.random() * (this.height - bottomAreaStartY),
			};
		}
		return {
			x: rightAreaStartX + Math.random() * (this.width - rightAreaStartX),
			y: bottomAreaStartY + Math.random() * (this.height - bottomAreaStartY),
		};
	}

	private pickTargetPoint() {
		const rightAreaStartX = this.width * 0.5;
		const bottomAreaStartY = this.height * 0.4;
		return {
			x: rightAreaStartX + Math.random() * (this.width - rightAreaStartX) * 0.8,
			y:
				bottomAreaStartY +
				Math.random() * (this.height - bottomAreaStartY) * 0.8,
		};
	}

	private getBaseHue(componentName: string): number {
		let hash = 0;
		for (let i = 0; i < componentName.length; i++) {
			hash = componentName.charCodeAt(i) + ((hash << 5) - hash);
		}
		// モルフォブルーの帯域に収める。コンポーネント差は色味の揺らぎ程度
		return 200 + (Math.abs(hash) % 14);
	}

	updateActiveButterflyCount() {
		const countElement = document.getElementById("butterfly-active-count");
		if (countElement) {
			countElement.textContent = this.butterflies.length.toString();
		}
	}

	private start() {
		if (this.running) return;
		this.running = true;
		this.idleFrames = 0;
		requestAnimationFrame(this.animate);
	}

	animate = () => {
		const chaos = this.chaosLevel();

		// clearRectでなく部分消去にすることで、直前フレームの残像が
		// フェードして軌跡になる。カオス度が高いほど消去を弱め、
		// 尾を長く引かせる
		this.ctx.save();
		this.ctx.globalCompositeOperation = "destination-out";
		this.ctx.fillStyle = `rgba(0, 0, 0, ${0.3 - 0.16 * chaos})`;
		this.ctx.fillRect(0, 0, this.width, this.height);
		this.ctx.restore();

		this.butterflies = this.butterflies.filter((butterfly) => {
			this.updateButterfly(butterfly, chaos);
			this.drawButterfly(butterfly, chaos);
			return butterfly.life < butterfly.maxLife;
		});

		this.drawVignette(chaos);
		this.updateActiveButterflyCount();

		if (this.butterflies.length === 0 && Date.now() >= this.stormUntil) {
			// 蝶が消えても軌跡とビネットが残っているため、
			// 完全に消え切るまで描き続けてから停止する
			this.idleFrames++;
			if (this.idleFrames > 60) {
				this.ctx.clearRect(0, 0, this.width, this.height);
				this.running = false;
				return;
			}
		} else {
			this.idleFrames = 0;
		}

		requestAnimationFrame(this.animate);
	};

	private updateButterfly(butterfly: Butterfly, chaos: number) {
		butterfly.life++;
		const progress = butterfly.life / butterfly.maxLife;

		const dx = butterfly.targetX - butterfly.x;
		const dy = butterfly.targetY - butterfly.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance < 30) {
			const next = this.pickTargetPoint();
			butterfly.targetX = next.x;
			butterfly.targetY = next.y;
		}

		// 直進+乱数ジッタだと虫らしさが出ないため、目標方向を
		// ノイズ場で連続的に曲げて蛇行させる
		const wander =
			this.noise2D(
				butterfly.x * 0.003 + butterfly.wanderSeed,
				butterfly.y * 0.003 - butterfly.wanderSeed,
			) *
			Math.PI *
			0.9;
		const desiredAngle = Math.atan2(dy, dx) + wander;
		const speed = butterfly.speed * (1 + chaos * 0.6);
		const desiredVx = Math.cos(desiredAngle) * speed;
		const desiredVy = Math.sin(desiredAngle) * speed;

		butterfly.vx += (desiredVx - butterfly.vx) * 0.08;
		butterfly.vy += (desiredVy - butterfly.vy) * 0.08;
		butterfly.x += butterfly.vx;
		butterfly.y += butterfly.vy;

		butterfly.heading = lerpAngle(
			butterfly.heading,
			Math.atan2(butterfly.vy, butterfly.vx),
			0.12,
		);
		butterfly.flapPhase += butterfly.flapSpeed * (1 + chaos * 0.8);

		const fadeIn = Math.min(1, butterfly.life / 12);
		const fadeOut = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;
		butterfly.opacity = fadeIn * fadeOut;
	}

	private drawButterfly(butterfly: Butterfly, chaos: number) {
		const { x, y, size, opacity, heading, flapPhase } = butterfly;
		// 蝶が増えるほど青(平穏)から紫紅(嵐の予兆)へ寄せる。
		// 連鎖の深い個体はさらに紫側へ振り、原因の遠い羽ばたきを見分けられるように
		const hue = butterfly.hue + chaos * 80 + Math.min(butterfly.depth, 5) * 8;
		const ctx = this.ctx;

		// |cos|そのままだと閉じている時間が長く見えるため、べき乗で
		// 開いた状態に滞留させてモルフォらしい滑空感を出す
		const fold = Math.abs(Math.cos(flapPhase));
		const spread = 0.18 + 0.82 * fold ** 0.6;
		// 構造色は翅を開いた時だけ現れる。青(表)⇔褐色(裏)の明滅が
		// モルフォの署名なので、開き具合を鋭くマッピングする
		const iri = fold ** 1.6;

		ctx.save();
		ctx.globalAlpha = opacity;
		ctx.translate(x, y);
		ctx.rotate(heading + Math.PI / 2);
		ctx.scale(size, size);

		const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.5);
		glow.addColorStop(0, `hsla(${hue}, 95%, 65%, ${0.06 + 0.26 * iri})`);
		glow.addColorStop(1, `hsla(${hue}, 95%, 65%, 0)`);
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(0, 0, 1.5, 0, TWO_PI);
		ctx.fill();

		const marginColor = "hsla(24, 32%, 10%, 0.96)";

		for (const side of [-1, 1]) {
			ctx.save();
			ctx.scale(side * spread, 1);

			// 縁取り(黒褐色)で全形を塗ってから、翅の付け根を原点に
			// 縮小した同じパスを重ねる。原点相似なので縁の幅が
			// 翅端ほど広がり、モルフォの暗色マージンの形になる
			ctx.fillStyle = marginColor;
			this.traceForewing(ctx);
			ctx.fill();
			this.traceHindwing(ctx);
			ctx.fill();

			ctx.save();
			ctx.scale(0.86, 0.86);

			// 翅裏の褐色を常に敷き、その上に構造色の青を開き具合の
			// アルファで重ねる。HSLの色相補間だと褐色→青の中間で
			// 緑を経由して濁るため、2層のクロスフェードにする
			const underside = ctx.createRadialGradient(
				0.1,
				-0.05,
				0.05,
				0.35,
				-0.15,
				1.05,
			);
			underside.addColorStop(0, "hsla(30, 42%, 44%, 0.95)");
			underside.addColorStop(0.6, "hsla(27, 36%, 33%, 0.94)");
			underside.addColorStop(1, "hsla(24, 32%, 25%, 0.92)");
			ctx.fillStyle = underside;
			this.traceForewing(ctx);
			ctx.fill();
			this.traceHindwing(ctx);
			ctx.fill();

			// 半開でも下地の褐色が透けると藍色に濁るため、
			// アルファは開き具合より先に飽和させ、頂点で純色を出す
			const blueAlpha = Math.min(1, iri * 1.45);
			if (blueAlpha > 0.03) {
				const structural = ctx.createRadialGradient(
					0.1,
					-0.05,
					0.05,
					0.35,
					-0.15,
					1.05,
				);
				structural.addColorStop(
					0,
					`hsla(${hue - 14}, 100%, 72%, ${blueAlpha})`,
				);
				structural.addColorStop(0.55, `hsla(${hue}, 96%, 56%, ${blueAlpha})`);
				structural.addColorStop(1, `hsla(${hue + 14}, 88%, 42%, ${blueAlpha})`);
				ctx.fillStyle = structural;
				this.traceForewing(ctx);
				ctx.fill();
				this.traceHindwing(ctx);
				ctx.fill();
			}

			ctx.restore();

			// 前翅の翅脈。開いている時だけ僅かに見せる
			if (iri > 0.3) {
				ctx.strokeStyle = `hsla(${hue + 20}, 60%, 20%, ${0.25 * iri})`;
				ctx.lineWidth = 0.015;
				for (const t of [0.3, 0.55, 0.8]) {
					ctx.beginPath();
					ctx.moveTo(0.08, -0.14);
					ctx.quadraticCurveTo(
						0.45 * t + 0.2,
						-0.85 * t,
						0.95 * t,
						-0.75 * t + 0.06,
					);
					ctx.stroke();
				}
			}

			ctx.restore();
		}

		ctx.fillStyle = "hsla(24, 28%, 12%, 0.96)";
		ctx.beginPath();
		ctx.ellipse(0, 0.06, 0.06, 0.4, 0, 0, TWO_PI);
		ctx.fill();

		ctx.strokeStyle = "hsla(24, 28%, 16%, 0.85)";
		ctx.lineWidth = 0.022;
		for (const side of [-1, 1]) {
			ctx.beginPath();
			ctx.moveTo(0, -0.3);
			ctx.quadraticCurveTo(side * 0.12, -0.52, side * 0.22, -0.58);
			ctx.stroke();
		}

		ctx.restore();
	}

	/** モルフォの幅広い前翅。丸みのある頂角と緩い外縁 */
	private traceForewing(ctx: CanvasRenderingContext2D) {
		ctx.beginPath();
		ctx.moveTo(0.04, -0.2);
		ctx.bezierCurveTo(0.3, -0.92, 0.85, -1.0, 1.02, -0.62);
		ctx.bezierCurveTo(1.1, -0.38, 0.95, -0.1, 0.6, -0.02);
		ctx.bezierCurveTo(0.35, 0.03, 0.1, 0.0, 0.04, -0.04);
		ctx.closePath();
	}

	/** 大きく丸い後翅。前翅の付け根に重ねて連続した輪郭に見せる */
	private traceHindwing(ctx: CanvasRenderingContext2D) {
		ctx.beginPath();
		ctx.moveTo(0.05, -0.06);
		ctx.bezierCurveTo(0.5, -0.05, 0.85, 0.22, 0.78, 0.52);
		ctx.bezierCurveTo(0.7, 0.85, 0.35, 1.0, 0.14, 0.86);
		ctx.bezierCurveTo(0.0, 0.72, 0.0, 0.3, 0.05, -0.06);
		ctx.closePath();
	}

	private drawVignette(chaos: number) {
		const desired = Math.max(0, (chaos - 0.5) * 0.5);
		if (desired <= 0) return;

		// 前フレームのビネットはdestination-outで部分的にしか消えないため、
		// 毎フレームの描画量は消去率との平衡値から逆算する
		const eraseAlpha = 0.3 - 0.16 * chaos;
		const perFrame = desired * eraseAlpha;

		const cx = this.width / 2;
		const cy = this.height / 2;
		const radius = Math.max(cx, cy) * 1.5;
		const gradient = this.ctx.createRadialGradient(
			cx,
			cy,
			radius * 0.45,
			cx,
			cy,
			radius,
		);
		gradient.addColorStop(0, "rgba(18, 8, 40, 0)");
		gradient.addColorStop(1, `rgba(18, 8, 40, ${perFrame})`);
		this.ctx.fillStyle = gradient;
		this.ctx.fillRect(0, 0, this.width, this.height);
	}
}

const LANE_HEIGHT = 22;
const LANE_GUTTER = 132;
const AXIS_HEIGHT = 24;

const depthColor = (depth: number): string => {
	const palette = ["#64748b", "#3b82f6", "#8b5cf6", "#c026d3", "#e11d48"];
	return palette[Math.min(depth, palette.length - 1)];
};

/** Effect_App_Line5_m3x2k → App:L5 */
const laneLabel = (effectId: string): string => {
	const match = effectId.match(/^Effect_(.+)_Line(\d+)_m/);
	if (!match) return effectId.slice(0, 16);
	const name = match[1].length > 12 ? `${match[1].slice(0, 12)}…` : match[1];
	return `${name}:L${match[2]}`;
};

const drawTimeline = (canvas: HTMLCanvasElement, recording: Recording) => {
	const lanes: string[] = [];
	for (const event of recording.events) {
		if (event.kind === "storm") continue;
		if (!lanes.includes(event.effectId)) {
			lanes.push(event.effectId);
		}
	}

	const width = Math.min(660, Math.max(320, window.innerWidth - 96));
	const height = AXIS_HEIGHT + Math.max(1, lanes.length) * LANE_HEIGHT + 8;
	const dpr = window.devicePixelRatio || 1;
	canvas.width = width * dpr;
	canvas.height = height * dpr;
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;

	// biome-ignore lint/style/noNonNullAssertion: canvas要素の2Dコンテキストは必ず取得できる
	const ctx = canvas.getContext("2d")!;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	const t0 = recording.startedAt;
	// 全イベントが同時刻でもゼロ除算にならないよう最低1msの幅を確保
	const t1 = Math.max(recording.stoppedAt, t0 + 1);
	const plotWidth = width - LANE_GUTTER - 16;
	const x = (ts: number) => LANE_GUTTER + ((ts - t0) / (t1 - t0)) * plotWidth;
	const y = (laneIndex: number) =>
		AXIS_HEIGHT + laneIndex * LANE_HEIGHT + LANE_HEIGHT / 2;

	ctx.font = "10px monospace";
	ctx.textBaseline = "middle";

	ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
	ctx.textAlign = "left";
	const durationMs = t1 - t0;
	for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
		const tickX = LANE_GUTTER + plotWidth * ratio;
		const ms = durationMs * ratio;
		const label =
			ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
		ctx.fillText(label, tickX - 8, AXIS_HEIGHT / 2);
		ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
		ctx.beginPath();
		ctx.moveTo(tickX, AXIS_HEIGHT - 4);
		ctx.lineTo(tickX, height - 8);
		ctx.stroke();
	}

	lanes.forEach((effectId, i) => {
		ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
		ctx.textAlign = "left";
		ctx.fillText(laneLabel(effectId), 8, y(i));

		ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
		ctx.beginPath();
		ctx.moveTo(LANE_GUTTER, y(i));
		ctx.lineTo(width - 16, y(i));
		ctx.stroke();
	});

	// イベントは時系列順なので、因果の矢印は「原因effectのレーンで
	// 直前に描いた点」へ遡って引ける
	const lastPointByLane = new Map<string, { x: number; y: number }>();

	for (const event of recording.events) {
		if (event.kind === "storm") {
			const px = x(event.timestamp);
			ctx.strokeStyle = "rgba(248, 113, 113, 0.7)";
			ctx.beginPath();
			ctx.moveTo(px, AXIS_HEIGHT - 4);
			ctx.lineTo(px, height - 8);
			ctx.stroke();
			ctx.fillStyle = "rgba(248, 113, 113, 0.9)";
			ctx.textAlign = "center";
			ctx.fillText("⚡", px, AXIS_HEIGHT / 2);
			ctx.textAlign = "left";
			continue;
		}

		const laneIndex = lanes.indexOf(event.effectId);
		const px = x(event.timestamp);
		const py = y(laneIndex);
		const color = depthColor(event.depth);

		if (event.kind === "effect-run") {
			if (event.causeEffectId) {
				const from = lastPointByLane.get(event.causeEffectId);
				if (from) {
					ctx.strokeStyle = color;
					ctx.globalAlpha = 0.45;
					ctx.beginPath();
					ctx.moveTo(from.x, from.y);
					ctx.quadraticCurveTo(
						(from.x + px) / 2,
						(from.y + py) / 2 - 10,
						px,
						py,
					);
					ctx.stroke();
					ctx.globalAlpha = 1;
				}
			}

			ctx.beginPath();
			ctx.arc(px, py, 4, 0, Math.PI * 2);
			if (event.isFirstRun) {
				ctx.strokeStyle = color;
				ctx.stroke();
			} else {
				ctx.fillStyle = color;
				ctx.fill();
			}
		} else {
			ctx.fillStyle = color;
			ctx.globalAlpha = 0.8;
			ctx.beginPath();
			ctx.moveTo(px, py - 3);
			ctx.lineTo(px + 3, py);
			ctx.lineTo(px, py + 3);
			ctx.lineTo(px - 3, py);
			ctx.closePath();
			ctx.fill();
			ctx.globalAlpha = 1;
		}

		lastPointByLane.set(event.effectId, { x: px, y: py });
	}
};

const showRecordingReport = (container: HTMLElement, recording: Recording) => {
	document.getElementById("butterfly-report")?.remove();

	const report = document.createElement("div");
	report.id = "butterfly-report";
	report.style.cssText = `
    position: absolute;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    background: rgba(10, 10, 18, 0.92);
    color: white;
    padding: 14px;
    border-radius: 8px;
    font-family: monospace;
    font-size: 12px;
    pointer-events: auto;
    backdrop-filter: blur(10px);
    max-width: calc(100vw - 40px);
  `;

	const durationSec = (
		(recording.stoppedAt - recording.startedAt) /
		1000
	).toFixed(1);
	const effectRuns = recording.events.filter(
		(e) => e.kind === "effect-run",
	).length;
	const stateUpdates = recording.events.length - effectRuns;

	const header = document.createElement("div");
	header.style.cssText =
		"display: flex; align-items: center; gap: 10px; margin-bottom: 10px;";
	header.innerHTML = `
    <span style="font-weight: bold; font-size: 13px;">🦋 Recording</span>
    <span id="butterfly-report-summary" style="opacity: 0.7;">${durationSec}s / effect runs: ${effectRuns} / setState: ${stateUpdates}${recording.truncated ? " (truncated)" : ""}</span>
    <span style="flex: 1;"></span>
    <button type="button" id="butterfly-report-export" style="
      padding: 3px 8px; border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;
      background: transparent; color: white; font-family: inherit; font-size: 11px; cursor: pointer;
    ">Export JSON</button>
    <button type="button" id="butterfly-report-close" style="
      padding: 3px 8px; border: none; border-radius: 4px;
      background: transparent; color: white; font-family: inherit; font-size: 13px; cursor: pointer;
    ">✕</button>
  `;
	report.appendChild(header);

	const scroller = document.createElement("div");
	scroller.style.cssText = "max-height: 40vh; overflow-y: auto;";
	const canvas = document.createElement("canvas");
	scroller.appendChild(canvas);
	report.appendChild(scroller);

	container.appendChild(report);
	drawTimeline(canvas, recording);

	header
		.querySelector("#butterfly-report-close")
		?.addEventListener("click", () => report.remove());
	header
		.querySelector("#butterfly-report-export")
		?.addEventListener("click", () => {
			const blob = new Blob([JSON.stringify(recording, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `butterfly-recording-${recording.startedAt}.json`;
			anchor.click();
			URL.revokeObjectURL(url);
		});
};

export function initOverlay(options: ButterflyEffectOptions) {
	// Create overlay container
	const container = document.createElement("div");
	container.id = "butterfly-effect-overlay";
	container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 999999;
  `;

	function setupCanvas() {
		const canvas = new ButterflyCanvas(container, options);

		if (options.showStatus) {
			const panel = document.createElement("div");
			panel.id = "butterfly-effect-status-panel";
			panel.style.cssText = `
        position: absolute;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 15px;
        border-radius: 8px;
        font-family: monospace;
        font-size: 12px;
        pointer-events: auto;
        min-width: 200px;
        backdrop-filter: blur(10px);
      `;
			panel.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 10px; font-size: 14px;">
          🦋 Butterfly Effect
        </div>
        <div>setState in Effect: <span id="butterfly-update-count">0</span></div>
        <div>Active Butterflies: <span id="butterfly-active-count">0</span></div>
        <div>Max Chain Depth: <span id="butterfly-max-depth">0</span></div>
        <div id="butterfly-storm" style="display: none; margin-top: 8px; color: #f87171; max-width: 260px;"></div>
        <button type="button" id="butterfly-record-toggle" style="
          margin-top: 10px;
          width: 100%;
          padding: 5px 8px;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 5px;
          background: transparent;
          color: white;
          font-family: inherit;
          font-size: 12px;
          cursor: pointer;
        ">⏺ Record</button>
      `;
			container.appendChild(panel);

			const recordButton = panel.querySelector<HTMLButtonElement>(
				"#butterfly-record-toggle",
			);
			recordButton?.addEventListener("click", () => {
				if (isRecording()) {
					const recording = stopRecording();
					recordButton.textContent = "⏺ Record";
					if (recording) {
						showRecordingReport(container, recording);
					}
				} else {
					document.getElementById("butterfly-report")?.remove();
					startRecording();
					recordButton.textContent = "⏹ Stop";
				}
			});
		}

		let updateCount = 0;
		let maxDepth = 0;
		ButterflyEvents.on((event: ButterflyEvent) => {
			if (event.depth > maxDepth) {
				maxDepth = event.depth;
				const maxDepthElem = document.getElementById("butterfly-max-depth");
				if (maxDepthElem) {
					maxDepthElem.textContent = maxDepth.toString();
				}
			}

			if (event.kind === "storm") {
				canvas.triggerStorm();
				const stormElem = document.getElementById("butterfly-storm");
				if (stormElem) {
					const path = [...event.cycle, event.cycle[0]]
						.map(laneLabel)
						.join(" → ");
					stormElem.textContent = `⚡ Update loop: ${path}`;
					stormElem.style.display = "block";
				}
				return;
			}

			// effect-runは因果データ用のイベント。蝶になるのは
			// 「effect内のsetState」= state-updateだけ
			if (event.kind !== "state-update") {
				return;
			}

			updateCount++;
			canvas.createButterfly(event);

			const updateCountElem = document.getElementById("butterfly-update-count");
			if (updateCountElem) {
				updateCountElem.textContent = updateCount.toString();
			}
		});
	}

	// パネル非表示(showStatus: false)でもコンソールやテストランナーから
	// 録画を操作できるように、プログラマブルAPIを公開する
	(window as unknown as Record<string, unknown>).__BUTTERFLY_EFFECT__ = {
		startRecording,
		stopRecording,
		isRecording,
		events: ButterflyEvents,
	};

	// Wait for DOM to be ready
	if (document.readyState === "loading") {
		// DOMの解釈(DOMツリーの構築)された時に発火
		document.addEventListener("DOMContentLoaded", () => {
			document.body.appendChild(container);
			setupCanvas();
		});
	} else {
		document.body.appendChild(container);
		setupCanvas();
	}
}
