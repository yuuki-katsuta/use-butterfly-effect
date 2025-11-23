import { useCallback, useEffect, useState } from "react";
import { execFn } from "./fn";

export const useSample = () => {
	const [countA, setCountA] = useState(0);

	const increment = useCallback(() => {
		execFn(() => {
			setCountA((prev) => prev + 1);
		});
	}, []);

	useEffect(() => {
		increment();
	}, [increment]);

	return { increment, countA };
};
