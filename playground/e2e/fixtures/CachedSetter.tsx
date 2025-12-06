import { useEffect, useState } from "react";

/**
 * CachedSetter
 * ラップされた setter がレンダリング毎に新しい関数になり
 * useEffect の意図しない発火が発生しないことを確認
 */
export function CachedSetter() {
	const [count, setCount] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: test
	useEffect(() => {
		setCount(1);
	}, [setCount]);

	return (
		<div>
			<h2>CachedSetter</h2>
			<p data-testid="count">Count: {count}</p>
			<button
				type="button"
				data-testid="increment"
				onClick={() => setCount((c) => c + 1)}
			>
				Increment
			</button>
		</div>
	);
}
