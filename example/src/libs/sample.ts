import { useCallback, useState } from "react";

export const useSample = () => {
	const [, setCountA] = useState(0);

	const increment = useCallback(() => {
		setCountA((prev) => prev + 1);
	}, []);

	return { increment };
};
