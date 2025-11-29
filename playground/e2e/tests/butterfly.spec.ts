import { expect, test } from "@playwright/test";

/**
 * ステータスパネルの State Updates カウンターを取得
 */
async function getUpdateCount(
	page: import("@playwright/test").Page,
): Promise<number> {
	const text = await page.locator("#butterfly-update-count").textContent();
	return parseInt(text || "0", 10);
}

/**
 * ステータスパネルが表示されるまで待機
 */
async function waitForStatusPanel(
	page: import("@playwright/test").Page,
): Promise<void> {
	await page.waitForSelector("#butterfly-effect-status-panel", {
		timeout: 5000,
	});
}

test.describe("Butterfly Effect E2E Tests", () => {
	test.describe("BasicUseEffect - 蝶が舞うケース", () => {
		test.beforeEach(async ({ page }) => {
			await page.goto("/#BasicUseEffect");
			await waitForStatusPanel(page);
		});

		test("初期マウント時はtrigger=falseなので蝶は舞わない", async ({
			page,
		}) => {
			const count = await getUpdateCount(page);
			expect(count).toBe(0);
		});

		test("TriggerボタンをクリックするとuseEffect内でsetStateが呼ばれ蝶が舞う", async ({
			page,
		}) => {
			const before = await getUpdateCount(page);

			await page.getByTestId("trigger").click();
			await page.waitForTimeout(100);

			const after = await getUpdateCount(page);
			expect(after - before).toBe(1);
		});

		test("複数回クリックで蝶が累積する", async ({ page }) => {
			const before = await getUpdateCount(page);

			// 3回クリック
			await page.getByTestId("trigger").click();
			await page.waitForTimeout(100);
			await page.getByTestId("trigger").click();
			await page.waitForTimeout(100);
			await page.getByTestId("trigger").click();
			await page.waitForTimeout(100);

			const after = await getUpdateCount(page);
			expect(after - before).toBe(2);
		});
	});

	test.describe("NoEffect - 蝶が舞わないケース", () => {
		test.beforeEach(async ({ page }) => {
			await page.goto("/#NoEffect");
			await waitForStatusPanel(page);
		});

		test("onClickハンドラ内で直接setStateを呼んでも蝶は舞わない", async ({
			page,
		}) => {
			const before = await getUpdateCount(page);

			await page.getByTestId("increment").click();
			await page.waitForTimeout(100);

			const after = await getUpdateCount(page);
			expect(after - before).toBe(0);
		});

		test("複数回クリックしても蝶は舞わない", async ({ page }) => {
			const before = await getUpdateCount(page);

			for (let i = 0; i < 5; i++) {
				await page.getByTestId("increment").click();
			}
			await page.waitForTimeout(100);

			const after = await getUpdateCount(page);
			expect(after - before).toBe(0);

			// カウントは増えること
			await expect(page.getByTestId("count")).toHaveText("Count: 5");
		});
	});

	test.describe("AsyncEffect - 蝶が舞うケース（非同期）", () => {
		test.beforeEach(async ({ page }) => {
			await page.goto("/#AsyncEffect");
			await waitForStatusPanel(page);
		});

		test.skip("非同期処理（await後）でもuseEffect内のsetStateは蝶が舞う", async ({
			page,
		}) => {
			const before = await getUpdateCount(page);

			await page.getByTestId("trigger").click();
			await page.waitForTimeout(700);

			const after = await getUpdateCount(page);
			expect(after - before).toBeGreaterThanOrEqual(2);
		});
	});

	test.describe("DependencyTrap - 蝶が舞うケース（依存配列の罠）", () => {
		test.beforeEach(async ({ page }) => {
			await page.goto("/#DependencyTrap");
			await waitForStatusPanel(page);
		});

		test("初期マウント時に子のuseEffectが発火して蝶が舞う", async ({
			page,
		}) => {
			// 初期マウント時にuseEffectが発火（StrictModeで2回）
			const count = await getUpdateCount(page);
			expect(count).toBeGreaterThanOrEqual(2);
		});

		test("親の再レンダリングで関数が再生成され、子のuseEffectが発火して蝶が舞う", async ({
			page,
		}) => {
			// 初期マウント後のカウントを記録
			await page.waitForTimeout(100);
			const before = await getUpdateCount(page);

			// 親を再レンダリング
			await page.getByTestId("trigger-parent").click();
			await page.waitForTimeout(100);

			const after = await getUpdateCount(page);
			// 親再レンダリング → 関数再生成 → 子useEffect発火 → 蝶が舞う
			expect(after - before).toBeGreaterThanOrEqual(1);
		});
	});

	test.describe("NestedEffect - 蝶が舞うケース（useEffect連鎖）", () => {
		test.beforeEach(async ({ page }) => {
			await page.goto("/#NestedEffect");
			await waitForStatusPanel(page);
		});

		test("triggerクリックでuseEffectが連鎖し、複数の蝶が舞う", async ({
			page,
		}) => {
			const before = await getUpdateCount(page);

			await page.getByTestId("trigger").click();
			await page.waitForTimeout(200);

			const after = await getUpdateCount(page);
			expect(after - before).toBeGreaterThanOrEqual(3);
		});

		test("stateA, stateB, stateCがすべてインクリメントされる", async ({
			page,
		}) => {
			await page.getByTestId("trigger").click();
			await page.waitForTimeout(200);

			await expect(page.getByTestId("state-a")).toContainText("1");
			await expect(page.getByTestId("state-b")).toContainText("1");
			await expect(page.getByTestId("state-c")).toContainText("1");
		});
	});

	test.describe("UseCallbackMemo - 蝶が舞わないケース（正しくメモ化）", () => {
		test.beforeEach(async ({ page }) => {
			await page.goto("/#UseCallbackMemo");
			await waitForStatusPanel(page);
		});

		test("初期マウント時にuseEffectは発火する（初回のみ）", async ({
			page,
		}) => {
			// 初期マウント時はuseEffectが発火（StrictModeで2回）
			const count = await getUpdateCount(page);
			expect(count).toBeGreaterThanOrEqual(2);
		});

		test("親が再レンダリングしてもメモ化された関数は同一参照なので蝶は舞わない", async ({
			page,
		}) => {
			// 初期マウント後のカウントを記録
			await page.waitForTimeout(100);
			const before = await getUpdateCount(page);

			// 親を再レンダリング
			await page.getByTestId("trigger-parent").click();
			await page.waitForTimeout(100);

			const after = await getUpdateCount(page);
			// useCallbackでメモ化されているので追加の蝶は舞わない
			expect(after - before).toBe(0);
		});

		test("複数回親を再レンダリングしても蝶は舞わない", async ({ page }) => {
			await page.waitForTimeout(100);
			const before = await getUpdateCount(page);

			for (let i = 0; i < 5; i++) {
				await page.getByTestId("trigger-parent").click();
			}
			await page.waitForTimeout(100);

			const after = await getUpdateCount(page);
			expect(after - before).toBe(0);

			// でもparentCountは増えている
			await expect(page.getByTestId("parent-count")).toHaveText(
				"Parent Count: 5",
			);
		});
	});

	test.describe("ステータスパネル", () => {
		test("ステータスパネルが表示されている", async ({ page }) => {
			await page.goto("/#BasicUseEffect");
			await waitForStatusPanel(page);

			const panel = page.locator("#butterfly-effect-status-panel");
			await expect(panel).toBeVisible();
			await expect(panel).toContainText("Butterfly Effect");
			await expect(panel).toContainText("State Updates:");
			await expect(panel).toContainText("Active Butterflies:");
		});
	});

	test.describe("Canvasオーバーレイ", () => {
		test("Canvasが存在し、正しいサイズで描画される", async ({ page }) => {
			await page.goto("/#BasicUseEffect");
			await waitForStatusPanel(page);

			const canvas = page.locator("#butterfly-effect-overlay canvas");
			await expect(canvas).toBeVisible();

			const viewportSize = page.viewportSize();
			if (viewportSize) {
				await expect(canvas).toHaveAttribute(
					"width",
					String(viewportSize.width),
				);
				await expect(canvas).toHaveAttribute(
					"height",
					String(viewportSize.height),
				);
			}
		});
	});
});
