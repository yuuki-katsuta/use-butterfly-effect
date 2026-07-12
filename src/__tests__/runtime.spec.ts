import { afterEach, describe, expect, test, vi } from "vitest";
import {
	__wrapEffect,
	__wrapSetter,
	ButterflyEvents,
	getCurrentEffectId,
} from "../runtime";
import type { ButterflyEvent } from "../types";

const collectEvents = () => {
	const events: ButterflyEvent[] = [];
	ButterflyEvents.on((e) => events.push(e));
	return events;
};

afterEach(() => {
	ButterflyEvents.clear();
});

describe("__wrapEffect", () => {
	test("同期実行中のみcurrentEffectIdを設定する", () => {
		let idDuringEffect: string | null = null;

		const wrapped = __wrapEffect("Effect_App_Line5", () => {
			idDuringEffect = getCurrentEffectId();
		});
		wrapped();

		expect(idDuringEffect).toBe("Effect_App_Line5");
		expect(getCurrentEffectId()).toBeNull();
	});

	test("cleanup実行中もeffectIdを設定する", () => {
		let idDuringCleanup: string | null = null;

		const wrapped = __wrapEffect("Effect_App_Line5", () => {
			return () => {
				idDuringCleanup = getCurrentEffectId();
			};
		});
		const cleanup = wrapped() as (() => void) | undefined;
		expect(typeof cleanup).toBe("function");
		cleanup?.();

		expect(idDuringCleanup).toBe("Effect_App_Line5");
		expect(getCurrentEffectId()).toBeNull();
	});

	test("effect本体が例外を投げてもcurrentEffectIdをリセットする", () => {
		const wrapped = __wrapEffect("Effect_App_Line5", () => {
			throw new Error("boom");
		});

		expect(() => wrapped()).toThrow("boom");
		expect(getCurrentEffectId()).toBeNull();
	});

	test("asyncコールバック（Promiseを返す）に偽のcleanupを返さない", () => {
		const wrapped = __wrapEffect("Effect_App_Line5", (async () => {
			/* async effect */
		}) as never);

		const cleanup = (wrapped as () => unknown)();

		// Promiseはcleanupとして扱わない（従来はここで関数を返し、
		// React側のcleanup呼び出しで TypeError が発生していた）
		expect(cleanup).toBeUndefined();
	});
});

describe("__wrapSetter", () => {
	test("同一のオリジナルsetterに対して同一のラッパーを返す（参照安定性）", () => {
		const original = vi.fn();
		const wrapped1 = __wrapSetter(original, "App", 3);
		const wrapped2 = __wrapSetter(original, "App", 3);

		expect(wrapped1).toBe(wrapped2);
	});

	test("バインドされたeffectId付きの呼び出しでイベントを発火する", () => {
		const events = collectEvents();
		const original = vi.fn();
		const wrapped = __wrapSetter(original, "App", 3);

		wrapped(42, "Effect_App_Line5");

		expect(original).toHaveBeenCalledWith(42);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			componentName: "App",
			line: 3,
			effectId: "Effect_App_Line5",
		});
	});

	test("effect外の呼び出し（effectIdなし）ではイベントを発火しない", () => {
		const events = collectEvents();
		const original = vi.fn();
		const wrapped = __wrapSetter(original, "App", 3);

		wrapped(42);

		expect(original).toHaveBeenCalledWith(42);
		expect(events).toHaveLength(0);
	});

	test("effect同期実行中はcurrentEffectIdにフォールバックする（useMemo/useCallback経由の帰属）", () => {
		const events = collectEvents();
		const original = vi.fn();
		const wrapped = __wrapSetter(original, "App", 3);

		// effect外で定義されたコールバック（バインドなしでsetterを呼ぶ）
		const externalCallback = () => wrapped(1);

		const effect = __wrapEffect("Effect_App_Line9", () => {
			externalCallback();
		});
		effect();

		expect(events).toHaveLength(1);
		expect(events[0].effectId).toBe("Effect_App_Line9");
	});

	test("effect外でsetterがコールバックとして渡された場合（forEachのindex等）はイベントを発火しない", () => {
		const events = collectEvents();
		const original = vi.fn();
		const wrapped = __wrapSetter(original, "App", 3);

		// forEachは (value, index, array) を渡すため、第2引数に数値が流れ込む
		[10, 20].forEach(wrapped);

		expect(original).toHaveBeenCalledTimes(2);
		expect(events).toHaveLength(0);
	});

	test("契約形式でないstringが第2引数に流れ込んでもイベントを発火しない", () => {
		const events = collectEvents();
		const original = vi.fn();
		const wrapped = __wrapSetter(original, "App", 3);

		// setterが (value, label) 形式のAPIにコールバックとして渡されたケース
		wrapped(42, "some-label");

		expect(original).toHaveBeenCalledWith(42);
		expect(events).toHaveLength(0);
	});
});

describe("ButterflyEvents", () => {
	test("onはリスナー解除関数を返す", () => {
		const events = collectEvents();
		const listener = vi.fn();
		const off = ButterflyEvents.on(listener);

		const wrapped = __wrapSetter(vi.fn(), "App", 1);
		wrapped(1, "Effect_App_Line2");
		expect(listener).toHaveBeenCalledTimes(1);

		off();
		wrapped(2, "Effect_App_Line2");
		expect(listener).toHaveBeenCalledTimes(1);
		expect(events).toHaveLength(2);
	});
});
