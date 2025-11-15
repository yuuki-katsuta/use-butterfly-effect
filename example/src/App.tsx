import { useCallback, useEffect, useState } from "react";
import viteLogo from "/vite.svg";
import reactLogo from "./assets/react.svg";
import { execFn } from "./libs/fn";
import { useSample } from "./libs/sample";
import { useExecFn } from "./libs/useExecFn";

import "./App.css";

function App() {
	const [count, setCount] = useState(0);

	const [a, setA] = useState(0);
	const [b, setB] = useState(0);
	const [c, setC] = useState(0);

	const updateA = () => {
		setA(count + 1);
	};

	const setCountAFn = useCallback(() => {
		console.log("setCountAFn called");
		setC(count + 1);
	}, [count]);

	const setCountBFn = useCallback(() => {
		setB(count + 1);
	}, [count]);

	const setCountBFnNested = useCallback(() => {
		setCountAFn();
	}, [setCountAFn]);

	// ------ Pattern 1: Regular function called from useEffect ------
	// biome-ignore lint/correctness/useExhaustiveDependencies: demo purposes
	useEffect(() => {
		updateA();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [count]);

	// // ------ Pattern 2: useCallback called from useEffect ------
	useEffect(() => {
		setCountBFn();
	}, [setCountBFn]);

	// ------ Pattern 3: Nested useCallback (function A -> function B -> setState) ------
	useEffect(() => {
		setCountBFnNested();
	}, [setCountBFnNested]);

	// ------ Pattern 4: Directly in component body ------
	const { increment } = useSample();
	useEffect(() => {
		increment();
	}, [increment]);

	// ------ Pattern 5: fn wrapper ------
	useEffect(() => {
		execFn(setCountAFn);
	}, [setCountAFn]);

	const { countA } = useExecFn();

	return (
		<>
			<div>
				<a href="https://vite.dev" target="_blank" rel="noopener">
					<img src={viteLogo} className="logo" alt="Vite logo" />
				</a>
				<a href="https://react.dev" target="_blank" rel="noopener">
					<img src={reactLogo} className="logo react" alt="React logo" />
				</a>
			</div>
			<h1>Nested Function Effect Chain Demo</h1>
			<div className="card">
				<button type="button" onClick={() => setCount((count) => count + 1)}>
					Click (count: {count})
				</button>
				countA:{countA}
				<p>a: {a}</p>
				<p>b: {b}</p>
				<p>c: {c}</p>
			</div>
		</>
	);
}

export default App;
