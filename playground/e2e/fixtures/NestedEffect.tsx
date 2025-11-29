import { useEffect, useState } from "react";

/**
 * NestedEffect - 蝶が舞うケース（useEffect連鎖）
 *
 * useEffect1でstateAを更新 → useEffect2がstateAの変化を検知 → stateBを更新
 * 連鎖的にuseEffectが発火し、複数の蝶が舞う。
 *
 * これはuseEffectの連鎖パターンで、バタフライエフェクトの本質を表現。
 */
export function NestedEffect() {
	const [trigger, setTrigger] = useState(false);
	const [stateA, setStateA] = useState(0);
	const [stateB, setStateB] = useState(0);
	const [stateC, setStateC] = useState(0);

	// 第1段階: triggerが変わるとstateAを更新
	useEffect(() => {
		if (trigger) {
			setStateA((a) => a + 1);
		}
	}, [trigger]);

	// 第2段階: stateAが変わるとstateBを更新
	useEffect(() => {
		if (stateA > 0) {
			setStateB((b) => b + 1);
		}
	}, [stateA]);

	// 第3段階: stateBが変わるとstateCを更新
	useEffect(() => {
		if (stateB > 0) {
			setStateC((c) => c + 1);
		}
	}, [stateB]);

	return (
		<div>
			<h2>NestedEffect</h2>
			<p>useEffectの連鎖パターン（蝶が複数舞う）</p>
			<p data-testid="state-a">State A: {stateA}</p>
			<p data-testid="state-b">State B: {stateB}</p>
			<p data-testid="state-c">State C: {stateC}</p>
			<button
				type="button"
				data-testid="trigger"
				onClick={() => setTrigger((t) => !t)}
			>
				Trigger Chain Reaction
			</button>
		</div>
	);
}
