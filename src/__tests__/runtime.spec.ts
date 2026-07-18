import { afterEach, describe, expect, test, vi } from "vitest";
import {
	__captureDeps,
	__wrapEffect,
	__wrapSetter,
	ButterflyEvents,
	getCurrentEffectId,
	type InstanceStore,
	isRecording,
	startRecording,
	stopRecording,
} from "../runtime";
import type { ButterflyEvent, EffectRunEvent } from "../types";

const collectEvents = () => {
	const events: ButterflyEvent[] = [];
	ButterflyEvents.on((e) => events.push(e));
	return events;
};

afterEach(() => {
	stopRecording();
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

		const stateEvents = events.filter((e) => e.kind === "state-update");
		expect(stateEvents).toHaveLength(1);
		expect(stateEvents[0].effectId).toBe("Effect_App_Line9");
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

describe("__captureDeps + 発火原因の特定", () => {
	const effectRuns = (events: ButterflyEvent[]): EffectRunEvent[] =>
		events.filter((e) => e.kind === "effect-run");

	test("depsをそのまま返す（Reactの比較セマンティクスを変えない）", () => {
		const inst: InstanceStore = {};
		const deps = [1, "a"];

		const returned = __captureDeps(
			inst,
			"Effect_App_Line5",
			["x", "y"],
			[null, null],
			deps,
		);

		expect(returned).toBe(deps);
	});

	test("初回実行はchangedDeps=null・isFirstRun=true・depth=0", () => {
		const events = collectEvents();
		const inst: InstanceStore = {};

		__captureDeps(inst, "Effect_App_Line5", ["count"], [null], [0]);
		__wrapEffect("Effect_App_Line5", () => {}, inst)();

		const [run] = effectRuns(events);
		expect(run).toMatchObject({
			kind: "effect-run",
			isFirstRun: true,
			changedDeps: null,
			depth: 0,
			causeEffectId: null,
		});
	});

	test("依存が変わらない再実行（StrictMode相当）はchangedDeps=[]でdepth=0", () => {
		const events = collectEvents();
		const inst: InstanceStore = {};
		const effect = __wrapEffect("Effect_App_Line5", () => {}, inst);

		__captureDeps(inst, "Effect_App_Line5", ["count"], [null], [0]);
		effect();
		__captureDeps(inst, "Effect_App_Line5", ["count"], [null], [0]);
		effect();

		const runs = effectRuns(events);
		expect(runs[1]).toMatchObject({
			isFirstRun: false,
			changedDeps: [],
			depth: 0,
		});
	});

	test("変化したdepの名前と値プレビューを報告する", () => {
		const events = collectEvents();
		const inst: InstanceStore = {};
		const effect = __wrapEffect("Effect_App_Line5", () => {}, inst);

		__captureDeps(
			inst,
			"Effect_App_Line5",
			["count", "name"],
			[null, null],
			[0, "x"],
		);
		effect();
		__captureDeps(
			inst,
			"Effect_App_Line5",
			["count", "name"],
			[null, null],
			[1, "x"],
		);
		effect();

		const runs = effectRuns(events);
		expect(runs[1].changedDeps).toHaveLength(1);
		expect(runs[1].changedDeps?.[0]).toMatchObject({
			name: "count",
			index: 0,
			prevPreview: "0",
			nextPreview: "1",
			sameValueNewRef: false,
		});
	});

	test("値は同じで参照だけ変わった依存にsameValueNewRefを立てる（メモ化漏れ検出）", () => {
		const events = collectEvents();
		const inst: InstanceStore = {};
		const effect = __wrapEffect("Effect_App_Line5", () => {}, inst);

		__captureDeps(
			inst,
			"Effect_App_Line5",
			["handler", "config"],
			[null, null],
			[() => {}, { mode: "auto", limit: 5 }],
		);
		effect();
		__captureDeps(
			inst,
			"Effect_App_Line5",
			["handler", "config"],
			[null, null],
			[() => {}, { mode: "auto", limit: 5 }],
		);
		effect();

		const runs = effectRuns(events);
		expect(runs[1].changedDeps?.[0].sameValueNewRef).toBe(true);
		expect(runs[1].changedDeps?.[1].sameValueNewRef).toBe(true);
	});

	test("中身が変わった配列・オブジェクトはsameValueNewRefにしない", () => {
		const events = collectEvents();
		const inst: InstanceStore = {};
		const effect = __wrapEffect("Effect_App_Line5", () => {}, inst);

		__captureDeps(
			inst,
			"Effect_App_Line5",
			["items", "config"],
			[null, null],
			[[1, 2, 3], { mode: "auto" }],
		);
		effect();
		__captureDeps(
			inst,
			"Effect_App_Line5",
			["items", "config"],
			[null, null],
			[[4, 5, 6], { mode: "manual" }],
		);
		effect();

		const runs = effectRuns(events);
		// 同じ長さの配列(Array(3)同士)でも中身が違えばメモ化漏れではない
		expect(runs[1].changedDeps?.[0].sameValueNewRef).toBe(false);
		expect(runs[1].changedDeps?.[1].sameValueNewRef).toBe(false);
	});

	test("handler起点の連鎖: 未帰属の書き込みで発火したeffectはdepth=1・causeEffectId=null", () => {
		const events = collectEvents();
		const original = vi.fn();
		const setCount = __wrapSetter(original, "App", 3);
		const inst: InstanceStore = {};
		const effect = __wrapEffect("Effect_App_Line8", () => {}, inst);

		__captureDeps(
			inst,
			"Effect_App_Line8",
			["count"],
			["State_App_Line3"],
			[0],
		);
		effect();

		// handlerからの書き込み（イベントにはならないが因果記録は残る）
		setCount(1);

		__captureDeps(
			inst,
			"Effect_App_Line8",
			["count"],
			["State_App_Line3"],
			[1],
		);
		effect();

		const runs = effectRuns(events);
		expect(runs[1]).toMatchObject({
			depth: 1,
			causeEffectId: null,
			causeStateId: "State_App_Line3",
		});
	});

	test("effect連鎖: 書き込み元effectを辿ってdepthが積み上がる", () => {
		const events = collectEvents();
		const setA = __wrapSetter(vi.fn(), "App", 3);
		const setB = __wrapSetter(vi.fn(), "App", 4);
		const inst: InstanceStore = {};

		// E1(handler起点でaを書く) → E2(a依存、bを書く) → E3(b依存)
		const e1 = __wrapEffect(
			"Effect_App_Line10",
			() => {
				setA(1);
			},
			inst,
		);
		const e2 = __wrapEffect(
			"Effect_App_Line14",
			() => {
				setB(1);
			},
			inst,
		);
		const e3 = __wrapEffect("Effect_App_Line18", () => {}, inst);

		__captureDeps(inst, "Effect_App_Line14", ["a"], ["State_App_Line3"], [0]);
		__captureDeps(inst, "Effect_App_Line18", ["b"], ["State_App_Line4"], [0]);
		e2();
		e3();

		e1(); // 初回deps記録なし → depth 0 で a を書く

		__captureDeps(inst, "Effect_App_Line14", ["a"], ["State_App_Line3"], [1]);
		e2(); // aの変化で発火 → cause=E1, depth=1 → b を depth1 で書く

		__captureDeps(inst, "Effect_App_Line18", ["b"], ["State_App_Line4"], [1]);
		e3(); // bの変化で発火 → cause=E2, depth=2

		const runs = effectRuns(events);
		const e2Second = runs.filter((r) => r.effectId === "Effect_App_Line14")[1];
		const e3Second = runs.filter((r) => r.effectId === "Effect_App_Line18")[1];

		expect(e2Second).toMatchObject({
			causeEffectId: "Effect_App_Line10",
			causeStateId: "State_App_Line3",
			depth: 1,
		});
		expect(e3Second).toMatchObject({
			causeEffectId: "Effect_App_Line14",
			causeStateId: "State_App_Line4",
			depth: 2,
		});

		// effect内のstate書き込みイベントにも深度が乗る
		const bUpdate = events.filter(
			(e) => e.kind === "state-update" && e.stateId === "State_App_Line4",
		);
		expect(bUpdate.at(-1)).toMatchObject({ depth: 1 });
	});

	test("非同期（Closure Binding）の書き込みは最終実行深度から復元する", () => {
		const events = collectEvents();
		const setA = __wrapSetter(vi.fn(), "App", 3);
		const inst: InstanceStore = {};

		let boundSetter: ((v: unknown) => void) | null = null;
		const effect = __wrapEffect(
			"Effect_App_Line10",
			() => {
				boundSetter = (v: unknown) => setA(v, "Effect_App_Line10");
			},
			inst,
		);

		// depth=1 の状況を作る（handler書き込み → dep変化で発火）
		const setTrigger = __wrapSetter(vi.fn(), "App", 2);
		__captureDeps(inst, "Effect_App_Line10", ["t"], ["State_App_Line2"], [0]);
		effect();
		setTrigger(1);
		__captureDeps(inst, "Effect_App_Line10", ["t"], ["State_App_Line2"], [1]);
		effect();

		// effect終了後（await後相当）の書き込み
		boundSetter?.(42);

		const updates = events.filter(
			(e) => e.kind === "state-update" && e.stateId === "State_App_Line3",
		);
		expect(updates.at(-1)).toMatchObject({
			effectId: "Effect_App_Line10",
			depth: 1,
		});
	});
});

describe("ストーム検知", () => {
	const storms = (events: ButterflyEvent[]) =>
		events.filter((e) => e.kind === "storm");

	test("自己ループ（effectが自分のdepを書く）でstormイベントを発火する", () => {
		const events = collectEvents();
		const setX = __wrapSetter(vi.fn(), "Loop", 3);
		const inst: InstanceStore = {};
		const effectId = "Effect_Loop_Line8_mself";
		const effect = __wrapEffect(
			effectId,
			() => {
				setX(1, effectId);
			},
			inst,
		);

		__captureDeps(inst, effectId, ["x"], ["State_Loop_Line3"], [0]);
		effect();
		__captureDeps(inst, effectId, ["x"], ["State_Loop_Line3"], [1]);
		effect();

		const detected = storms(events);
		expect(detected).toHaveLength(1);
		expect(detected[0]).toMatchObject({ cycle: [effectId] });
	});

	test("同一循環はクールダウン中に再通知しない", () => {
		const events = collectEvents();
		const setX = __wrapSetter(vi.fn(), "Loop2", 3);
		const inst: InstanceStore = {};
		const effectId = "Effect_Loop2_Line8_mcool";
		const effect = __wrapEffect(
			effectId,
			() => {
				setX(1, effectId);
			},
			inst,
		);

		__captureDeps(inst, effectId, ["x"], ["State_Loop2_Line3"], [0]);
		effect();
		for (let i = 1; i <= 5; i++) {
			__captureDeps(inst, effectId, ["x"], ["State_Loop2_Line3"], [i]);
			effect();
		}

		expect(storms(events)).toHaveLength(1);
	});

	test("2つのeffectが互いを発火させ合う循環を検出する", () => {
		const events = collectEvents();
		const setX = __wrapSetter(vi.fn(), "Ping", 3);
		const setY = __wrapSetter(vi.fn(), "Ping", 4);
		const inst: InstanceStore = {};
		const idA = "Effect_Ping_Line10_mab";
		const idB = "Effect_Ping_Line14_mab";
		const effectA = __wrapEffect(
			idA,
			() => {
				setX(1, idA);
			},
			inst,
		);
		const effectB = __wrapEffect(
			idB,
			() => {
				setY(1, idB);
			},
			inst,
		);

		// A(y依存でxを書く) ⇄ B(x依存でyを書く)
		__captureDeps(inst, idA, ["y"], ["State_Ping_Line4"], [0]);
		effectA();
		__captureDeps(inst, idB, ["x"], ["State_Ping_Line3"], [1]);
		effectB();
		__captureDeps(inst, idA, ["y"], ["State_Ping_Line4"], [1]);
		effectA();
		__captureDeps(inst, idB, ["x"], ["State_Ping_Line3"], [2]);
		effectB();

		const detected = storms(events);
		expect(detected.length).toBeGreaterThanOrEqual(1);
		expect(detected[0].cycle).toContain(idA);
		expect(detected[0].cycle).toContain(idB);
	});

	test("循環しない直線の連鎖ではstormを発火しない", () => {
		const events = collectEvents();
		const setA = __wrapSetter(vi.fn(), "Chain", 3);
		const setB = __wrapSetter(vi.fn(), "Chain", 4);
		const inst: InstanceStore = {};
		const id1 = "Effect_Chain_Line10_mlin";
		const id2 = "Effect_Chain_Line14_mlin";
		const id3 = "Effect_Chain_Line18_mlin";
		const e1 = __wrapEffect(
			id1,
			() => {
				setA(1, id1);
			},
			inst,
		);
		const e2 = __wrapEffect(
			id2,
			() => {
				setB(1, id2);
			},
			inst,
		);
		const e3 = __wrapEffect(id3, () => {}, inst);

		__captureDeps(inst, id2, ["a"], ["State_Chain_Line3"], [0]);
		e2();
		__captureDeps(inst, id3, ["b"], ["State_Chain_Line4"], [0]);
		e3();

		e1();
		__captureDeps(inst, id2, ["a"], ["State_Chain_Line3"], [1]);
		e2();
		__captureDeps(inst, id3, ["b"], ["State_Chain_Line4"], [1]);
		e3();

		expect(storms(events)).toHaveLength(0);
	});
});

describe("Recording", () => {
	test("録画中に観測したイベントだけを収集する", () => {
		const setter = __wrapSetter(vi.fn(), "App", 3);

		setter(1, "Effect_App_Line5");
		startRecording();
		setter(2, "Effect_App_Line5");
		setter(3, "Effect_App_Line5");
		const recording = stopRecording();
		setter(4, "Effect_App_Line5");

		expect(recording).not.toBeNull();
		expect(recording?.events).toHaveLength(2);
		expect(recording?.truncated).toBe(false);
		expect(recording?.startedAt).toBeLessThanOrEqual(recording?.stoppedAt ?? 0);
		expect(recording?.events.every((e) => e.kind === "state-update")).toBe(
			true,
		);
	});

	test("state-updateとeffect-runの両方を記録する", () => {
		const setter = __wrapSetter(vi.fn(), "App", 3);
		const inst: InstanceStore = {};
		const effect = __wrapEffect(
			"Effect_App_Line8",
			() => {
				setter(1);
			},
			inst,
		);

		startRecording();
		effect();
		const recording = stopRecording();

		const kinds = recording?.events.map((e) => e.kind);
		expect(kinds).toContain("effect-run");
		expect(kinds).toContain("state-update");
	});

	test("isRecordingが録画状態を反映し、二重startと停止済みstopは無害", () => {
		expect(isRecording()).toBe(false);
		expect(stopRecording()).toBeNull();

		startRecording();
		startRecording();
		expect(isRecording()).toBe(true);

		const recording = stopRecording();
		expect(recording).not.toBeNull();
		expect(isRecording()).toBe(false);
	});
});
