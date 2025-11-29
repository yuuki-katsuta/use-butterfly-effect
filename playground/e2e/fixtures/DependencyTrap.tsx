import { useEffect, useState } from "react";

/**
 * DependencyTrap - 蝶が舞うケース（依存配列の罠）
 *
 * 親コンポーネントが再レンダリングするたびに新しい関数が生成され、
 * 子コンポーネントのuseEffectの依存配列が変化を検知し、
 * useEffectが発火してsetStateが呼ばれる。
 *
 * これはReactでよくある罠パターン。
 * ボタンをクリック→親再レンダリング→関数再生成→子useEffect発火→蝶が舞う
 */
export function DependencyTrap() {
	const [parentCount, setParentCount] = useState(0);

	// 毎レンダリングで新しい関数が生成される（メモ化されていない）
	const unstableCallback = () => {
		// この関数自体は何もしない
	};

	return (
		<div>
			<h2>DependencyTrap</h2>
			<p>依存配列の関数再生成による罠パターン</p>
			<p data-testid="parent-count">Parent Count: {parentCount}</p>
			<button
				type="button"
				data-testid="trigger-parent"
				onClick={() => setParentCount((c) => c + 1)}
			>
				Trigger Parent Re-render
			</button>
			<hr />
			<ChildWithUnstableCallback onCallback={unstableCallback} />
		</div>
	);
}

function ChildWithUnstableCallback({ onCallback }: { onCallback: () => void }) {
	const [childCount, setChildCount] = useState(0);

	// onCallbackが変わるたびにuseEffectが発火
	useEffect(() => {
		// 親が再レンダリングするたびにここが実行される！
		setChildCount((c) => c + 1);
		onCallback();
	}, [onCallback]);

	return (
		<div>
			<p data-testid="child-count">Child Effect Count: {childCount}</p>
		</div>
	);
}
