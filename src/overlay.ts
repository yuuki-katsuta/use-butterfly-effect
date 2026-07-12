import { createNoise2D } from "simplex-noise";
import { ButterflyEvents } from "./runtime.js";
import type {
	Butterfly,
	ButterflyEffectOptions,
	ButterflyEvent,
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
      `;
			container.appendChild(panel);
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
