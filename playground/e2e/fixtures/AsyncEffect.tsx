import { useEffect, useState } from "react";

/**
 * AsyncEffect - 蝶が舞うケース（非同期）
 *
 * useEffect内でawait後にsetStateを呼ぶ。
 * 非同期処理後でも蝶が舞う。
 */
export function AsyncEffect() {
	const [count, setCount] = useState(0);
	const [trigger, setTrigger] = useState(false);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!trigger) return;

		async function fetchData() {
			setLoading(true);
			const sleep = () => new Promise((resolve) => setTimeout(resolve, 500));
			await sleep();
			setCount((c) => c + 1);
			setLoading(false);
		}

		fetchData();
	}, [trigger]);

	return (
		<div>
			<h2>AsyncEffect</h2>
			<p>useEffect内でawait後にsetState（蝶が舞う）</p>
			<p data-testid="count">Count: {count}</p>
			<p data-testid="loading">Loading: {loading ? "true" : "false"}</p>
			<button
				type="button"
				data-testid="trigger"
				onClick={() => setTrigger((t) => !t)}
			>
				Trigger Async Effect
			</button>
		</div>
	);
}
