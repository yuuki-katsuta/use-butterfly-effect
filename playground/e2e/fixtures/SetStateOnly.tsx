import { useEffect, useState } from "react";

/**
 * SetStateOnly
 *
 * useStateの第一引数を省略するパターン
 */
export function SetStateOnly() {
	const [, setCount] = useState(0);

	useEffect(() => {
		setCount(1);
	}, []);

	return (
		<div>
			<h2>SetStateOnly</h2>
			<p>set関数のみ使用する場合</p>
		</div>
	);
}
