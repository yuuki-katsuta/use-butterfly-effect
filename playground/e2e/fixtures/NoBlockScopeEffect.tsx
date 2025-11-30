import { useEffect, useState } from "react";

/**
 * NoBlockScopeEffect
 *
 * ブロックスコープの無いuseEffect
 */
export function NoBlockScopeEffect() {
	const [count, setCount] = useState(0);
	const [trigger, setTrigger] = useState(true);

	useEffect(() => (trigger ? setCount((p) => p + 1) : () => {}), [trigger]);

	return (
		<div>
			<h2>NoBlockScopeEffect</h2>
			<p>ブロックスコープの無いuseEffect（蝶が舞う）</p>
			<p data-testid="count">Count: {count}</p>
			<button
				type="button"
				data-testid="trigger"
				onClick={() => setTrigger((t) => !t)}
			>
				Trigger Effect
			</button>
		</div>
	);
}
