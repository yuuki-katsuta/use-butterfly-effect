# 🦋 Butterfly Effect - Vite Plugin

A Vite plugin that visualizes React useEffect and state update chains as butterfly effects. Transform debugging into a beautiful, enjoyable experience.


https://github.com/user-attachments/assets/1a563ffe-b9af-4d5a-8bb0-303cd58dd037


<details><summary>Effect chain demo code</summary>

```ts
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import viteLogo from "/vite.svg";
import reactLogo from "./assets/react.svg";
import { execFn } from "./modules/fn";
import { sleep } from "./modules/sleep";
import { useRender } from "./modules/useRender";
import "./App.css";

function App() {
	const [countA, setCountA] = useState(0);
	const [countB, setCountB] = useState(0);

	const callbacks = useMemo(
		() => ({
			updateA: (arg: number) =>
				execFn(() => {
					flushSync(() => {
						setCountA((p) => p + arg);
						setCountB((p) => p + arg);
						setCountB((p) => p + arg);
						setCountB((p) => p + arg);
						setCountB((p) => p + arg);
						setCountB((p) => p + arg);
						setCountB((p) => p + arg);
					});
				}),
			updateB: (arg: number) => execFn(() => setCountB((p) => p + arg)),
		}),
		[],
	);

	const { render } = useRender();

	useEffect(() => {
		async function fetch() {
			await sleep();
			exec();
			function exec() {
				execFn(() => {
					setCountA(1);
					setCountA(1);
					setCountA(1);
					setCountA(1);
				});
			}
		}
		fetch();
	}, []);

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
			<h1>Butterfly(use)Effect</h1>
			<div className="card">
				<button type="button" onClick={() => callbacks.updateA(1)}>
					Click (countA: {countA})
				</button>
				<button type="button" onClick={() => callbacks.updateB(1)}>
					Click (countB: {countB})
				</button>
				{render()}
				<p>countA: {countA}</p>
				<MyComponent
					onClick={() => {
						execFn(() => {
							setCountA(1);
							setCountA(1);
							setCountA(1);
							setCountA(1);
						});
					}}
				/>
			</div>
		</>
	);
}

const MyComponent = ({ onClick }: { onClick: () => void }) => {
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

```

</details>

## TODO

- [ ] Reactive Signals 方式への移行
