import { useEffect, useState } from "react";
import viteLogo from "/vite.svg";
import reactLogo from "./assets/react.svg";
import "./App.css";

function App() {
	const [count, setCount] = useState(0);
	const [doubleCount, setDoubleCount] = useState(0);
	const [tripleCount, setTripleCount] = useState(0);

	// Effect Chain 1
	useEffect(() => {
		setDoubleCount(count * 2);
	}, [count]);

	// Effect Chain 2
	useEffect(() => {
		setTripleCount(count * 3);
	}, [count]);

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
				<div style={{ marginTop: "20px", fontSize: "18px" }}>
					<p>
						<strong>Double Count:</strong> {doubleCount}
					</p>
					<p>
						<strong>Triple Count:</strong> {tripleCount}
					</p>
				</div>
			</div>
		</>
	);
}

export default App;
