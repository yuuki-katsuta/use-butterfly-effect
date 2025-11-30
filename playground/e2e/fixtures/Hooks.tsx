import { useCallback, useEffect, useState } from "react";

/**
 * HooksEffect
 *
 * カスタフックから返されるsetter含む関数を実行した場合
 */
export function HooksEffect() {
	const { count, increment } = useCounter();

	useEffect(() => {
		increment();
	}, [increment]);

	return (
		<div>
			<h2>HooksEffect</h2>
			<p>カスタフックから返されるsetter含む関数を実行した場合</p>
			<p data-testid="count">Count: {count}</p>
			<button type="button" data-testid="trigger" onClick={increment}>
				increment
			</button>
		</div>
	);
}

function useCounter() {
	const [count, setCount] = useState(0);
	const increment = useCallback(() => {
		setCount((p) => p + 1);
	}, []);

	return { count, increment };
}
