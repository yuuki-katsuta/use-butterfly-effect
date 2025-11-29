import { useCallback, useEffect, useState } from "react";

/**
 * UseCallbackMemo - 蝶が舞わないケース（正しくメモ化）
 *
 * DependencyTrapと同じ構造だが、useCallbackでメモ化されているため、
 * 親が再レンダリングしても関数は同一参照を維持。
 * 子のuseEffectは発火しない（初回マウント時を除く）。
 */
export function UseCallbackMemo() {
	const [parentCount, setParentCount] = useState(0);

	// useCallbackでメモ化されている
	const stableCallback = useCallback(() => {
		// この関数は再生成されない
	}, []);

	return (
		<div>
			<h2>UseCallbackMemo</h2>
			<p>useCallbackでメモ化（親再レンダリングでも蝶は舞わない）</p>
			<p data-testid="parent-count">Parent Count: {parentCount}</p>
			<button
				type="button"
				data-testid="trigger-parent"
				onClick={() => setParentCount((c) => c + 1)}
			>
				Trigger Parent Re-render
			</button>
			<hr />
			<ChildWithStableCallback onCallback={stableCallback} />
		</div>
	);
}

function ChildWithStableCallback({ onCallback }: { onCallback: () => void }) {
	const [childCount, setChildCount] = useState(0);

	// onCallbackはメモ化されているので、親再レンダリングでは発火しない
	useEffect(() => {
		setChildCount((c) => c + 1);
		onCallback();
	}, [onCallback]);

	return (
		<div>
			<p data-testid="child-count">Child Effect Count: {childCount}</p>
		</div>
	);
}
