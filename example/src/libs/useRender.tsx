/** biome-ignore-all lint/correctness/useExhaustiveDependencies: plugin demo */
import React, { useCallback, useEffect, useState } from "react";

export const useRender = () => {
	const [number, setNumber] = useState(0);
	const [trigger, setTrigger] = useState(false);

	useEffect(() => {
		setNumber((p) => p + 1);
	}, [trigger]);

	const render = useCallback(() => {
		const up = () => {
			setTrigger((prev) => !prev);
		};

		return (
			<React.Fragment>
				<button type="button" onClick={up}>
					count up
				</button>
				<br />
				number: {number}
			</React.Fragment>
		);
	}, [number]);

	return { render };
};
