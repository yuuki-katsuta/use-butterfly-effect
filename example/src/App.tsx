import { startTransition, useEffect, useMemo, useState } from "react";
import viteLogo from "/vite.svg";
import reactLogo from "./assets/react.svg";
import "./App.css";
import { execFn } from "./libs/fn";

// import { useSample } from "./libs/hoge";
// import { useHuga } from "./libs/huga";
// import { execFn } from "./libs/fn";

function App() {
	const [count, setCount] = useState(0);

	const callbacks = useMemo(
		() => ({ update: (arg: number) => execFn(() => setCount(arg)) }),
		[],
	);

	useEffect(() => {
		startTransition(() => callbacks.update(1));
	}, [callbacks]);

	// useEffect(() => {
	// 	startTransition(() => callbacks.update(1));
	// }, [count]);

	// const { increment, countA } = useSample();

	// useEffect(() => {
	// 	setCount((p) => p + 1);
	// }, [countA]);

	// useHuga(useMemo(() => [count], [count]));

	// useSample();

	// useHuga(useMemo(() => [count], [count]));

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
				{/* <p>countA: {countA}</p>
				<MyComponent onClick={increment} /> */}
			</div>
		</>
	);
}

export const MyComponent = ({ onClick }: { onClick: () => void }) => {
	useEffect(() => {
		onClick();
	}, [onClick]);

	return (
		<button type="button" onClick={onClick}>
			ボタン
		</button>
	);
};

export default App;
