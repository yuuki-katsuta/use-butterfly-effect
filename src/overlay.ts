import { createNoise2D } from "simplex-noise";
import { ButterflyEvents } from "./runtime.js";
import type {
	Butterfly,
	ButterflyEffectOptions,
	ButterflyEvent,
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

	/** 蝶の数に対する飽和度。色相・羽ばたき・軌跡・ビネットの強度を駆動する */
	private chaosLevel(): number {
		const max = Math.max(1, this.options.maxButterflies || 10);
		return Math.min(1, this.butterflies.length / max);
	}

	createButterfly(event: ButterflyEvent) {
		if (this.butterflies.length >= (this.options?.maxButterflies || 0)) {
			this.butterflies.shift();
		}

		const { x, y } = this.pickSpawnPoint();
		const { x: targetX, y: targetY } = this.pickTargetPoint();

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
			flapSpeed: 0.28 + Math.random() * 0.14,
			speed: 2.2 + Math.random() * 2,
			size: 16 + Math.random() * 12,
			hue: this.getBaseHue(event.componentName),
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
		return 200 + (Math.abs(hash) % 40);
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

		if (this.butterflies.length === 0) {
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
		// 蝶が増えるほど青(平穏)から紫紅(嵐の予兆)へ寄せる
		const hue = butterfly.hue + chaos * 90;
		const ctx = this.ctx;

		ctx.save();
		ctx.globalAlpha = opacity;
		ctx.translate(x, y);
		ctx.rotate(heading + Math.PI / 2);
		ctx.scale(size, size);

		const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.4);
		glow.addColorStop(0, `hsla(${hue}, 90%, 70%, 0.28)`);
		glow.addColorStop(1, `hsla(${hue}, 90%, 70%, 0)`);
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(0, 0, 1.4, 0, TWO_PI);
		ctx.fill();

		// cosで左右の翼を同位相に折りたたみ、真上から見た羽ばたきに見せる
		const spread = 0.22 + 0.78 * Math.abs(Math.cos(flapPhase));

		for (const side of [-1, 1]) {
			ctx.save();
			ctx.scale(side * spread, 1);

			const wing = ctx.createLinearGradient(0, -0.6, 1.1, 0.4);
			wing.addColorStop(0, `hsla(${hue}, 85%, 72%, 0.95)`);
			wing.addColorStop(1, `hsla(${hue + 30}, 75%, 48%, 0.9)`);
			ctx.fillStyle = wing;

			ctx.beginPath();
			ctx.moveTo(0.04, -0.12);
			ctx.bezierCurveTo(0.45, -1.05, 1.2, -0.72, 0.92, -0.12);
			ctx.bezierCurveTo(0.78, 0.02, 0.35, 0.02, 0.04, -0.06);
			ctx.closePath();
			ctx.fill();

			ctx.beginPath();
			ctx.moveTo(0.04, 0.0);
			ctx.bezierCurveTo(0.5, 0.06, 0.72, 0.48, 0.42, 0.82);
			ctx.bezierCurveTo(0.18, 1.0, 0.03, 0.5, 0.02, 0.08);
			ctx.closePath();
			ctx.fill();

			ctx.strokeStyle = `hsla(${hue + 40}, 70%, 30%, 0.35)`;
			ctx.lineWidth = 0.02;
			ctx.beginPath();
			ctx.moveTo(0.04, -0.12);
			ctx.bezierCurveTo(0.45, -1.05, 1.2, -0.72, 0.92, -0.12);
			ctx.stroke();

			ctx.restore();
		}

		ctx.fillStyle = `hsla(${hue + 40}, 40%, 22%, 0.95)`;
		ctx.beginPath();
		ctx.ellipse(0, 0.08, 0.07, 0.42, 0, 0, TWO_PI);
		ctx.fill();

		ctx.strokeStyle = `hsla(${hue + 40}, 40%, 25%, 0.8)`;
		ctx.lineWidth = 0.025;
		for (const side of [-1, 1]) {
			ctx.beginPath();
			ctx.moveTo(0, -0.3);
			ctx.quadraticCurveTo(side * 0.12, -0.5, side * 0.2, -0.55);
			ctx.stroke();
		}

		ctx.restore();
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
      `;
			container.appendChild(panel);
		}

		let updateCount = 0;
		ButterflyEvents.on((event: ButterflyEvent) => {
			updateCount++;
			canvas.createButterfly(event);

			const updateCountElem = document.getElementById("butterfly-update-count");
			if (updateCountElem) {
				updateCountElem.textContent = updateCount.toString();
			}
		});
	}

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
