import { useCallback } from "react";

export const useExecFn = () => {
	const exec = useCallback((fn: () => void) => {
		fn();
	}, []);

	// useEffect(() => {
	// 	exec();
	// }, [exec]);
	return { exec };
};
