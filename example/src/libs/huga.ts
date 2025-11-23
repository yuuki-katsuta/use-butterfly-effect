/** biome-ignore-all lint/correctness/useExhaustiveDependencies: plugin demo */
import { useEffect, useMemo, useState } from "react";

export const useHuga = (deps: unknown[]) => {
	const [num, setNum] = useState(0);

	const memoDeps = useMemo(() => deps, [deps]);

	useEffect(() => {
		setNum((pre) => pre + 1);
	}, [memoDeps]);

	return { num };
};
