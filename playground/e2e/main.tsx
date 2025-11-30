import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AsyncEffect } from "./fixtures/AsyncEffect";
import { BasicUseEffect } from "./fixtures/BasicUseEffect";
import { DependencyTrap } from "./fixtures/DependencyTrap";
import { HooksEffect } from "./fixtures/Hooks";
import { NestedEffect } from "./fixtures/NestedEffect";
import { NoBlockScopeEffect } from "./fixtures/NOBlockScopeEffect";
import { NoEffect } from "./fixtures/NoEffect";
import { UseCallbackMemo } from "./fixtures/UseCallbackMemo";

const fixtures: Record<string, React.FC> = {
	BasicUseEffect,
	NoEffect,
	NoBlockScopeEffect,
	AsyncEffect,
	DependencyTrap,
	HooksEffect,
	NestedEffect,
	UseCallbackMemo,
};

export const App = () => {
	const [route, setRoute] = useState(() => window.location.hash.slice(1) || "");

	useEffect(() => {
		const handleHashChange = () => {
			setRoute(window.location.hash.slice(1));
		};
		window.addEventListener("hashchange", handleHashChange);
		return () => window.removeEventListener("hashchange", handleHashChange);
	}, []);

	const Fixture = fixtures[route];

	if (!Fixture) {
		return (
			<div style={{ padding: 20 }}>
				<h1>E2E Test Fixtures</h1>
				<ul>
					{Object.keys(fixtures).map((name) => (
						<li key={name}>
							<a href={`#${name}`}>{name}</a>
						</li>
					))}
				</ul>
			</div>
		);
	}

	return (
		<div style={{ padding: 20 }}>
			<nav style={{ marginBottom: 20 }}>
				<a href="#">Back to list</a>
				<span style={{ margin: "0 10px" }}>|</span>
				<strong>{route}</strong>
			</nav>
			<Fixture />
		</div>
	);
};

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
