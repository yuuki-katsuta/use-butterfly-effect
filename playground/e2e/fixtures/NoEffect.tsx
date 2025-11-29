import { useState } from "react";

/**
 * NoEffect - 蝶が舞わないケース
 *
 * onClickハンドラ内で直接setStateを呼ぶ。
 * useEffect内ではないので蝶は舞わない。
 */
export function NoEffect() {
	const [count, setCount] = useState(0);

	return (
		<div>
			<h2>NoEffect</h2>
			<p>onClickハンドラ内で直接setState（蝶は舞わない）</p>
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
