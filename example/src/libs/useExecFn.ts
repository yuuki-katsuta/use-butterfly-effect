import { useCallback, useEffect, useState } from "react";

const useSampleState = () => {
	const [countA, setCountA] = useState(0);
	const increment = useCallback(() => {
		console.log("🔥---increment called---");
		setCountA((prev) => prev + 1);
	}, []);

	return { countA, setCountA, increment };
};

export const useExecFn = () => {
	const { countA, setCountA, increment } = useSampleState();
	const exec = useCallback(() => {
		setCountA((prev) => prev + 1);
		increment();
	}, [increment, setCountA]);

	useEffect(() => {
		exec();
	}, [exec]);
	return { exec, countA };
};
