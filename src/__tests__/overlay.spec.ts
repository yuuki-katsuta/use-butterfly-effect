import { beforeEach, describe, expect, test, vi } from "vitest";
import { ButterflyEvents, stopRecording } from "../runtime";
import type { ButterflyEffectOptions } from "../types";

describe("initOverlay", () => {
	beforeEach(() => {
		// Arrange: 各テスト前にDOMをクリーンアップ
		document.body.innerHTML = "";
		vi.clearAllMocks();

		// Clear event listeners to prevent cross-test contamination
		stopRecording();
		ButterflyEvents.clear();

		// Mock canvas context for testing
		// happy-dom doesn't fully support canvas 2D context.
		// 個別メソッドを列挙する方式だと描画実装の変更のたびにモックが
		// 壊れるため、任意のメソッド呼び出しとプロパティ代入を受け付ける
		// Proxyで代用する
		const mockGetContext = vi.fn((contextType: string) => {
			if (contextType === "2d") {
				const gradient = { addColorStop: vi.fn() };
				const methods = new Map<string | symbol, unknown>();
				return new Proxy(
					{},
					{
						get(_target, prop) {
							if (prop === "canvas") {
								return { width: window.innerWidth, height: window.innerHeight };
							}
							if (
								prop === "createLinearGradient" ||
								prop === "createRadialGradient"
							) {
								return () => gradient;
							}
							if (!methods.has(prop)) {
								methods.set(prop, vi.fn());
							}
							return methods.get(prop);
						},
						set() {
							return true;
						},
					},
				) as unknown as CanvasRenderingContext2D;
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
			expect(statusPanel?.textContent).toContain("setState in Effect:");
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
				kind: "state-update",
				id: "test-1",
				componentName: "TestComponent",
				line: 10,
				timestamp: Date.now(),
				effectId: "Effect_TestComponent_Line5",
				stateId: "State_TestComponent_Line3",
				depth: 1,
			});

			// Assert: カウントが更新されていることを確認
			const updateCountElem = document.getElementById("butterfly-update-count");
			expect(updateCountElem?.textContent).toBe("1");

			// さらにイベントを発火
			ButterflyEvents.emit({
				kind: "state-update",
				id: "test-2",
				componentName: "TestComponent",
				line: 15,
				timestamp: Date.now(),
				effectId: "Effect_TestComponent_Line5",
				stateId: "State_TestComponent_Line3",
				depth: 1,
			});

			// Assert: カウントが2になっていることを確認
			expect(updateCountElem?.textContent).toBe("2");
		});

		test("effect-runイベントはMax Depthだけを更新し、蝶のカウントには含めない", async () => {
			const options: ButterflyEffectOptions = {
				enabled: true,
				showStatus: true,
			};

			Object.defineProperty(document, "readyState", {
				writable: true,
				value: "complete",
			});

			const { initOverlay } = await import("../overlay");
			initOverlay(options);

			ButterflyEvents.emit({
				kind: "effect-run",
				id: "run-1",
				effectId: "Effect_TestComponent_Line5",
				timestamp: Date.now(),
				isFirstRun: false,
				depth: 3,
				changedDeps: [],
				causeEffectId: null,
				causeStateId: null,
			});

			expect(document.getElementById("butterfly-max-depth")?.textContent).toBe(
				"3",
			);
			expect(
				document.getElementById("butterfly-update-count")?.textContent,
			).toBe("0");
		});
	});

	describe("録画とレポート", () => {
		const setup = async () => {
			Object.defineProperty(document, "readyState", {
				writable: true,
				value: "complete",
			});
			const { initOverlay } = await import("../overlay");
			initOverlay({ enabled: true, showStatus: true });
		};

		test("Recordボタンで録画を開始・停止し、停止後にレポートが表示される", async () => {
			await setup();

			const button = document.getElementById(
				"butterfly-record-toggle",
			) as HTMLButtonElement;
			expect(button).not.toBeNull();
			expect(button.textContent).toContain("Record");

			button.click();
			expect(button.textContent).toContain("Stop");

			ButterflyEvents.emit({
				kind: "state-update",
				id: "rec-1",
				componentName: "App",
				line: 4,
				timestamp: Date.now(),
				effectId: "Effect_App_Line8_mtest",
				stateId: "State_App_Line4_mtest",
				depth: 1,
			});
			ButterflyEvents.emit({
				kind: "effect-run",
				id: "rec-2",
				effectId: "Effect_App_Line8_mtest",
				timestamp: Date.now(),
				isFirstRun: false,
				depth: 1,
				changedDeps: [],
				causeEffectId: null,
				causeStateId: null,
			});

			button.click();
			expect(button.textContent).toContain("Record");

			const report = document.getElementById("butterfly-report");
			expect(report).not.toBeNull();
			expect(
				document.getElementById("butterfly-report-summary")?.textContent,
			).toContain("effect runs: 1");
			expect(document.getElementById("butterfly-report-export")).not.toBeNull();
		});

		test("✕ボタンでレポートを閉じられる", async () => {
			await setup();

			const button = document.getElementById(
				"butterfly-record-toggle",
			) as HTMLButtonElement;
			button.click();
			button.click();

			const close = document.getElementById(
				"butterfly-report-close",
			) as HTMLButtonElement;
			expect(close).not.toBeNull();
			close.click();

			expect(document.getElementById("butterfly-report")).toBeNull();
		});

		test("stormイベントで循環パスの警告が表示される", async () => {
			await setup();

			ButterflyEvents.emit({
				kind: "storm",
				id: "storm-1",
				timestamp: Date.now(),
				cycle: ["Effect_Loop_Line8_mtest"],
				depth: 4,
			});

			const storm = document.getElementById("butterfly-storm");
			expect(storm?.style.display).toBe("block");
			expect(storm?.textContent).toContain("⚡ Update loop:");
			expect(storm?.textContent).toContain("Loop:L8 → Loop:L8");
			// stormは蝶のカウントに含めない
			expect(
				document.getElementById("butterfly-update-count")?.textContent,
			).toBe("0");
		});

		test("プログラマブルAPIをwindowに公開する", async () => {
			await setup();

			const api = (
				window as unknown as {
					__BUTTERFLY_EFFECT__?: Record<string, unknown>;
				}
			).__BUTTERFLY_EFFECT__;
			expect(api).toBeDefined();
			expect(typeof api?.startRecording).toBe("function");
			expect(typeof api?.stopRecording).toBe("function");
			expect(typeof api?.isRecording).toBe("function");
		});
	});
});
