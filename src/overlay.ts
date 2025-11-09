import { ButterflyEvents } from "./runtime";
import type { ButterflyEffectOptions } from "./types";

// Butterfly Canvas Implementation
class ButterflyCanvas {
	private options: ButterflyEffectOptions;
	private butterflies: any[] = [];
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

	animate() {}
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
		ButterflyEvents.on(() => {
			updateCount++;
			const updateCountElem = document.getElementById("butterfly-update-count");
			if (updateCountElem) {
				updateCountElem.textContent = updateCount.toString();
			}
		});

		console.log("[Butterfly Effect] Overlay initialized");
	}

	// Wait for DOM to be ready
}
