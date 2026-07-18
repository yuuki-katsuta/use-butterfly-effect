import { useEffect, useState } from "react";

/**
 * StormLoop - 更新ループ（嵐）の検出ケース
 *
 * effectが自分の依存stateを書き換えるため、マウント直後から
 * count=30まで連鎖的に再実行される。ストーム検知の対象。
 */
export function StormLoop() {
	const [count, setCount] = useState(0);

	useEffect(() => {
		if (count < 30) {
			setCount(count + 1);
		}
	}, [count]);

	return (
		<div>
			<h2>StormLoop</h2>
			<p>effectが自分のdepを書くループ（⚡が出る）</p>
			<p data-testid="count">Count: {count}</p>
		</div>
	);
}
