import { useCallback } from "react";

export const useExecFn = () => {
	const exec = useCallback((fn: () => void) => {
		fn();
	}, []);

	return { exec };
};
