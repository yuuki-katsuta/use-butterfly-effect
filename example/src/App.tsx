import { useEffect, useState } from "react";
import viteLogo from "/vite.svg";
import reactLogo from "./assets/react.svg";
import "./App.css";

function App() {
	const [count, setCount] = useState(0);

	const [a, setA] = useState(0);
	const [b, setB] = useState(0);
	const [c, setC] = useState(0);

	useEffect(() => {
		setB(count + 1);
	}, [count]);

	useEffect(() => {
		setA(b + 1);
	}, [b]);

	useEffect(() => {
		setC(a + 1);
	}, [a]);

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
			<h1>Effect Chain Demo</h1>
			<div className="card">
				<button type="button" onClick={() => setCount((count) => count + 1)}>
					Click (count: {count})
				</button>
				<p>a: {a}</p>
				<p>b: {b}</p>
				<p>c: {c}</p>
			</div>
		</>
	);
}

export default App;
