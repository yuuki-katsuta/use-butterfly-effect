import { beforeEach, describe, expect, test, vi } from "vitest";
import { ButterflyEvents } from "../runtime";
import type { ButterflyEffectOptions } from "../types";

describe("initOverlay", () => {
	beforeEach(() => {
		// Arrange: 各テスト前にDOMをクリーンアップ
		document.body.innerHTML = "";
		vi.clearAllMocks();

		// Clear event listeners to prevent cross-test contamination
		ButterflyEvents.clear();

		// Mock canvas context for testing
		// happy-dom doesn't fully support canvas 2D context
		const mockGetContext = vi.fn((contextType: string) => {
			if (contextType === "2d") {
				return {
					clearRect: vi.fn(),
					save: vi.fn(),
					restore: vi.fn(),
					translate: vi.fn(),
					fillText: vi.fn(),
					globalAlpha: 1,
					font: "",
					textAlign: "center",
					textBaseline: "middle",
					canvas: {
						width: window.innerWidth,
						height: window.innerHeight,
					},
				} as unknown as CanvasRenderingContext2D;
			}
			return null;
		});

		HTMLCanvasElement.prototype.getContext = mockGetContext as any;

		// Mock window.addEventListener for resize
		vi.spyOn(window, "addEventListener");
	});

	describe("オーバーレイコンテナの作成", () => {
		test("DOMが既に読み込まれている場合、オーバーレイコンテナがbodyに追加されること", async () => {
			// Arrange: テスト用のオプションを準備
			const options: ButterflyEffectOptions = {
				enabled: true,
				theme: "default",
				showStatus: false,
				animationSpeed: 1000,
				maxButterflies: 10,
			};

			// document.readyStateを'complete'に設定（既に読み込み済み）
			Object.defineProperty(document, "readyState", {
				writable: true,
				value: "complete",
			});

			// Act: initOverlay関数を動的インポートして実行
			const { initOverlay } = await import("../overlay");
			initOverlay(options);

			// Assert: オーバーレイコンテナが存在することを確認
			const overlay = document.getElementById("butterfly-effect-overlay");
			expect(overlay).not.toBeNull();
			expect(overlay?.style.position).toBe("fixed");
			expect(overlay?.style.zIndex).toBe("999999");
		});

		test("DOMがまだ読み込み中の場合、DOMContentLoadedイベント後にオーバーレイが追加されること", async () => {
			// Arrange: DOMを読み込み中の状態に設定
			Object.defineProperty(document, "readyState", {
				writable: true,
				value: "loading",
			});

			const options: ButterflyEffectOptions = {
				enabled: true,
				theme: "default",
				showStatus: false,
			};

			// Act: initOverlay関数を実行
			const { initOverlay } = await import("../overlay");
			initOverlay(options);

			// Assert: イベント発火前はオーバーレイが存在しない
			let overlay = document.getElementById("butterfly-effect-overlay");
			expect(overlay).toBeNull();

			// DOMContentLoadedイベントを手動でトリガー
			document.dispatchEvent(new Event("DOMContentLoaded"));

			// Assert: イベント発火後はオーバーレイが存在する
			overlay = document.getElementById("butterfly-effect-overlay");
			expect(overlay).not.toBeNull();
		});
	});

	describe("ステータスパネルの表示", () => {
		test("showStatusがtrueの場合、ステータスパネルが表示されること", async () => {
			// Arrange
			const options: ButterflyEffectOptions = {
				enabled: true,
				showStatus: true,
			};

			Object.defineProperty(document, "readyState", {
				writable: true,
				value: "complete",
			});

			// Act
			const { initOverlay } = await import("../overlay");
			initOverlay(options);

			// Assert: ステータスパネルが存在することを確認
			const statusPanel = document.getElementById(
				"butterfly-effect-status-panel",
			);
			expect(statusPanel).not.toBeNull();
			expect(statusPanel?.textContent).toContain("🦋 Butterfly Effect");
			expect(statusPanel?.textContent).toContain("State Updates:");
			expect(statusPanel?.textContent).toContain("Active Butterflies:");
		});

		test("showStatusがfalseの場合、ステータスパネルが表示されないこと", async () => {
			// Arrange
			const options: ButterflyEffectOptions = {
				enabled: true,
				showStatus: false,
			};

			Object.defineProperty(document, "readyState", {
				writable: true,
				value: "complete",
			});

			// Act
			const { initOverlay } = await import("../overlay");
			initOverlay(options);

			// Assert: ステータスパネルが存在しないことを確認
			const statusPanel = document.getElementById(
				"butterfly-effect-status-panel",
			);
			expect(statusPanel).toBeNull();
		});
	});

	describe("Canvasの初期化", () => {
		test("オーバーレイコンテナ内にcanvas要素が作成されること", async () => {
			// Arrange
			const options: ButterflyEffectOptions = {
				enabled: true,
			};

			Object.defineProperty(document, "readyState", {
				writable: true,
				value: "complete",
			});

			// Act
			const { initOverlay } = await import("../overlay");
			initOverlay(options);

			// Assert: Canvas要素が存在することを確認
			const overlay = document.getElementById("butterfly-effect-overlay");
			const canvas = overlay?.querySelector("canvas");
			expect(canvas).not.toBeNull();
			expect(canvas?.style.width).toBe("100%");
			expect(canvas?.style.height).toBe("100%");
		});

		test("Canvasのサイズがウィンドウサイズに合わせて設定されること", async () => {
			// Arrange
			const options: ButterflyEffectOptions = {
				enabled: true,
			};

			Object.defineProperty(document, "readyState", {
				writable: true,
				value: "complete",
			});

			// ウィンドウサイズをモック
			Object.defineProperty(window, "innerWidth", {
				writable: true,
				value: 1024,
			});
			Object.defineProperty(window, "innerHeight", {
				writable: true,
				value: 768,
			});

			// Act
			const { initOverlay } = await import("../overlay");
			initOverlay(options);

			// Assert: Canvasのサイズがウィンドウサイズと一致することを確認
			const overlay = document.getElementById("butterfly-effect-overlay");
			const canvas = overlay?.querySelector("canvas") as HTMLCanvasElement;
			expect(canvas.width).toBe(1024);
			expect(canvas.height).toBe(768);
		});
	});

	describe("イベントリスナー", () => {
		test("ButterflyEventsのイベントを受信すると、updateCountが更新されること", async () => {
			// Arrange
			const options: ButterflyEffectOptions = {
				enabled: true,
				showStatus: true,
			};

			Object.defineProperty(document, "readyState", {
				writable: true,
				value: "complete",
			});

			// Act
			const { initOverlay } = await import("../overlay");
			initOverlay(options);

			// イベントを発火
			ButterflyEvents.emit({
				id: "test-1",
				componentName: "TestComponent",
				filePath: "test.tsx",
				line: 10,
				column: 5,
				timestamp: Date.now(),
				type: "state",
				nextValue: 42,
			});

			// Assert: カウントが更新されていることを確認
			const updateCountElem = document.getElementById("butterfly-update-count");
			expect(updateCountElem?.textContent).toBe("1");

			// さらにイベントを発火
			ButterflyEvents.emit({
				id: "test-2",
				componentName: "TestComponent",
				filePath: "test.tsx",
				line: 15,
				column: 5,
				timestamp: Date.now(),
				type: "state",
				nextValue: 100,
			});

			// Assert: カウントが2になっていることを確認
			expect(updateCountElem?.textContent).toBe("2");
		});
	});
});
