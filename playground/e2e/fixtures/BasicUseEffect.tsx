import { useEffect, useState } from "react";

/**
 * BasicUseEffect - 蝶が舞うケース
 *
 * triggerボタンをクリックすると、useEffect内でsetStateが呼ばれ、
 * 蝶が1匹舞う（StrictModeでは2匹）
 */
export function BasicUseEffect() {
	const [count, setCount] = useState(0);
	const [trigger, setTrigger] = useState(false);

	useEffect(() => {
		if (trigger) {
			setCount((c) => c + 1);
		}
	}, [trigger]);

	return (
		<div>
			<h2>BasicUseEffect</h2>
			<p>useEffect内でsetStateを呼ぶ基本ケース</p>
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
