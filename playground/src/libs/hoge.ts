import { useCallback, useEffect, useState } from "react";
import { execFn } from "./fn";

export const useSample = () => {
	const [count, setCount] = useState(0);

	const increment = useCallback(() => {
		execFn(() => {
			setCount((prev) => prev + 1);
		});
	}, []);

	useEffect(() => {
		increment();
	}, [increment]);

	return { increment, count };
};
