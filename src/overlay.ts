import { ButterflyEvents } from "vite-plugin-butterfly-effect/runtime";
import type {
	Butterfly,
	ButterflyEffectOptions,
	ButterflyEvent,
} from "./types";

// Butterfly Canvas Implementation
class ButterflyCanvas {
	private options: ButterflyEffectOptions;
	private butterflies: Butterfly[] = [];
	private animationFrame: number | null = null;
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;

	constructor(container: HTMLElement, options: ButterflyEffectOptions) {
		console.log("ButterflyCanvas initialized with options:", options);

		this.options = options;
		this.butterflies = [];
		this.animationFrame = null;

		this.canvas = document.createElement("canvas");
		this.canvas.style.cssText = "width: 100%; height: 100%; display: block;";
		container.appendChild(this.canvas);

		// Canvas上に描画するための2Dコンテキストを取得
		// biome-ignore lint/style/noNonNullAssertion: canvas要素の2Dコンテキストは必ず取得できる
		this.ctx = this.canvas.getContext("2d")!;
		// ウィンドウサイズに合わせてCanvasのピクセルサイズを設定
		this.resize();

		window.addEventListener("resize", () => this.resize());
		this.animate();
	}

	resize() {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
	}

	createButterfly(event: ButterflyEvent) {
		if (this.butterflies.length >= (this.options?.maxButterflies || 0)) {
			this.butterflies.shift();
		}

		console.log("[ButterflyCanvas] Creating butterfly for event:", event);

		// Define bottom-right area boundaries
		const rightAreaStartX = this.canvas.width * 0.5; // Right half
		const bottomAreaStartY = this.canvas.height * 0.4; // Bottom 60%

		// Random starting position within bottom-right area or from edges
		const edge = Math.random();
		let x: number;
		let y: number;

		if (edge < 0.3) {
			// Start from bottom edge
			x =
				rightAreaStartX + Math.random() * (this.canvas.width - rightAreaStartX);
			y = this.canvas.height + 50;
		} else if (edge < 0.6) {
			// Start from right edge
			x = this.canvas.width + 50;
			y =
				bottomAreaStartY +
				Math.random() * (this.canvas.height - bottomAreaStartY);
		} else {
			// Start from within the bottom-right area
			x =
				rightAreaStartX + Math.random() * (this.canvas.width - rightAreaStartX);
			y =
				bottomAreaStartY +
				Math.random() * (this.canvas.height - bottomAreaStartY);
		}

		// Target position: within bottom-right area
		const targetX =
			rightAreaStartX +
			Math.random() * (this.canvas.width - rightAreaStartX) * 0.8;
		const targetY =
			bottomAreaStartY +
			Math.random() * (this.canvas.height - bottomAreaStartY) * 0.8;

		const butterfly = {
			id: event.id,
			x,
			y,
			targetX,
			targetY,
			angle: Math.random() * Math.PI * 2,
			speed: 3 + Math.random() * 3,
			size: 25 + Math.random() * 20,
			color: this.getColor(event.componentName),
			opacity: 1,
			life: 0,
			maxLife: (this.options?.animationSpeed || 0) / 16,
		};

		this.butterflies.push(butterfly);
		this.updateActiveButterflyCount();
	}

	getColor(componentName: string) {
		// Blue color with variations
		let hash = 0;
		for (let i = 0; i < componentName.length; i++) {
			hash = componentName.charCodeAt(i) + ((hash << 5) - hash);
		}
		// Blue hues: 200-240 degrees
		const hue = 200 + (hash % 40);
		return `hsl(${hue}, 70%, 60%)`;
	}

	updateActiveButterflyCount() {
		const countElement = document.getElementById("butterfly-active-count");
		if (countElement) {
			countElement.textContent = this.butterflies.length.toString();
		}
	}

	animate = () => {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		this.butterflies = this.butterflies.filter((butterfly) => {
			this.updateButterfly(butterfly);
			this.drawButterfly(butterfly);
			return butterfly.life < butterfly.maxLife;
		});

		this.updateActiveButterflyCount();
		this.animationFrame = requestAnimationFrame(this.animate);
	};

	updateButterfly(butterfly: Butterfly) {
		butterfly.life++;
		const progress = butterfly.life / butterfly.maxLife;

		const dx = butterfly.targetX - butterfly.x;
		const dy = butterfly.targetY - butterfly.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance > 1) {
			butterfly.x +=
				(dx / distance) * butterfly.speed + (Math.random() - 0.5) * 2;
			butterfly.y +=
				(dy / distance) * butterfly.speed + (Math.random() - 0.5) * 2;
		}

		butterfly.angle += 0.2;

		if (progress > 0.7) {
			butterfly.opacity = 1 - (progress - 0.7) / 0.3;
		}
	}

	drawButterfly(butterfly: Butterfly) {
		const { x, y, size, opacity } = butterfly;

		this.ctx.save();
		this.ctx.globalAlpha = opacity;
		this.ctx.translate(x, y);

		// 絵文字で蝶を表現
		this.ctx.font = `${size}px serif`;
		this.ctx.textAlign = "center";
		this.ctx.textBaseline = "middle";
		this.ctx.fillText("🦋", 0, 0);

		this.ctx.restore();
	}

	// drawButterfly(butterfly: Butterfly) {
	// 	const { x, y, angle, size, color, opacity } = butterfly;

	// 	this.ctx.save();
	// 	this.ctx.globalAlpha = opacity;
	// 	this.ctx.translate(x, y);

	// 	// Draw body
	// 	this.ctx.fillStyle = "#1a3a52"; // Dark blue body
	// 	this.ctx.fillRect(-3, -size / 2, 6, size);

	// 	const wingFlap = Math.sin(angle) * 0.3;

	// 	// Left wing
	// 	this.ctx.beginPath();
	// 	this.ctx.ellipse(
	// 		-size / 3,
	// 		0,
	// 		size / 2,
	// 		size / 1.5,
	// 		-Math.PI / 4 + wingFlap,
	// 		0,
	// 		Math.PI * 2,
	// 	);
	// 	this.ctx.fillStyle = color;
	// 	this.ctx.fill();

	// 	// Left wing outline
	// 	this.ctx.strokeStyle = "#0a2540";
	// 	this.ctx.lineWidth = 2;
	// 	this.ctx.stroke();

	// 	// Right wing
	// 	this.ctx.beginPath();
	// 	this.ctx.ellipse(
	// 		size / 3,
	// 		0,
	// 		size / 2,
	// 		size / 1.5,
	// 		Math.PI / 4 - wingFlap,
	// 		0,
	// 		Math.PI * 2,
	// 	);
	// 	this.ctx.fillStyle = color;
	// 	this.ctx.fill();

	// 	// Right wing outline
	// 	this.ctx.strokeStyle = "#0a2540";
	// 	this.ctx.lineWidth = 2;
	// 	this.ctx.stroke();

	// 	// Add white highlights for depth
	// 	this.ctx.globalAlpha = opacity * 0.4;

	// 	// Left wing highlight
	// 	this.ctx.beginPath();
	// 	this.ctx.ellipse(
	// 		-size / 3 - size / 8,
	// 		-size / 8,
	// 		size / 4,
	// 		size / 3,
	// 		-Math.PI / 4 + wingFlap,
	// 		0,
	// 		Math.PI * 2,
	// 	);
	// 	this.ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
	// 	this.ctx.fill();

	// 	// Right wing highlight
	// 	this.ctx.beginPath();
	// 	this.ctx.ellipse(
	// 		size / 3 + size / 8,
	// 		-size / 8,
	// 		size / 4,
	// 		size / 3,
	// 		Math.PI / 4 - wingFlap,
	// 		0,
	// 		Math.PI * 2,
	// 	);
	// 	this.ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
	// 	this.ctx.fill();

	// 	this.ctx.restore();
	// }
}

export function initOverlay(options: ButterflyEffectOptions) {
	console.log("[Butterfly Effect] Initializing overlay...", options);

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

	function initOverlay() {
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
        <div>State Updates: <span id="butterfly-update-count">0</span></div>
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

		console.log("[Butterfly Effect] Overlay initialized");
	}

	// Wait for DOM to be ready
	if (document.readyState === "loading") {
		// DOMの解釈(DOMツリーの構築)された時に発火
		document.addEventListener("DOMContentLoaded", () => {
			document.body.appendChild(container);
			initOverlay();
		});
	} else {
		document.body.appendChild(container);
		initOverlay();
	}
}
