import generateDefault from "@babel/generator";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import traverseDefault from "@babel/traverse";
import * as t from "@babel/types";
import type { ButterflyEffectOptions } from "./types";

// Handle default exports for both ESM and CJS
type TraverseFunction = typeof traverseDefault;
type GenerateFunction = typeof generateDefault;

const traverse: TraverseFunction =
	(traverseDefault as any).default ?? traverseDefault;

const generate: GenerateFunction =
	(generateDefault as any).default ?? generateDefault;

type TransformOptions = Pick<
	ButterflyEffectOptions,
	"trackEffect" | "trackState"
>;

/**
 * Information about a function defined in the component
 */
interface FunctionInfo {
	name: string;
	node:
		| t.ArrowFunctionExpression
		| t.FunctionExpression
		| t.FunctionDeclaration;
	path: NodePath;
	isHook: boolean; // true for useCallback wrapped functions
	bodyPath: NodePath<t.BlockStatement> | NodePath | null;
}

/**
 * Transform React code to inject state tracking ONLY for setState calls within useEffect
 */
export const transformReactCode = (code: string, options: TransformOptions) => {
	const { trackState } = options;

	if (!trackState) {
		return null;
	}

	// Quick pre-check to avoid parsing files without React hooks
	// Process files that have useState (for tracking setState calls)
	if (!code.includes("useState")) {
		return null;
	}

	try {
		// Parse code to AST with support for JSX and TypeScript
		const ast = parse(code, {
			sourceType: "module",
			plugins: ["jsx", "typescript"],
		});

		// Track useState setter names for each component scope
		const setterNames = new Set<string>();
		let componentName = "Unknown";
		let hasTransformed = false;
		const needsImport = !code.includes("__trackStateUpdate");

		// Registry to store all function definitions in the component
		const functionRegistry = new Map<string, FunctionInfo>();

		// Track instrumented locations to prevent duplicate injections
		// Key format: "line:column"
		const instrumentedLocations = new Set<string>();

		traverse(ast, {
			// Extract component name from function declarations or variable declarations

			// Handle: function handleClick() { ... }
			FunctionDeclaration(path) {
				if (isReactComponent(path)) {
					componentName = path.node.id?.name || "Unknown";
				}

				// Collect regular function declarations defined in the component
				const name = path.node.id?.name;
				if (name && isDefinedInComponentOrHook(path)) {
					functionRegistry.set(name, {
						name,
						node: path.node,
						path,
						isHook: false,
						bodyPath: path.get("body") as NodePath<t.BlockStatement>,
					});
				}
			},

			// Handle: const ComponentName = () => { ... }
			VariableDeclarator(path) {
				if (
					t.isIdentifier(path.node.id) &&
					(t.isArrowFunctionExpression(path.node.init) ||
						t.isFunctionExpression(path.node.init))
				) {
					const name = path.node.id.name;
					// Check if it looks like a component (starts with uppercase) or custom hook (starts with "use")
					if (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) {
						componentName = name;
					}
				}

				// Extract useState setter names
				// const [count, setCount] = useState(0);
				if (isUseStateCall(path.node.init) && t.isLVal(path.node.id)) {
					const setter = extractSetterName(path.node.id);
					if (setter) {
						setterNames.add(setter);
					}
				}

				// Collect function definitions (regular functions and useCallback/useMemo)
				if (t.isIdentifier(path.node.id)) {
					const name = path.node.id.name;
					const init = path.node.init;

					// Regular arrow/function expressions
					if (
						(t.isArrowFunctionExpression(init) ||
							t.isFunctionExpression(init)) &&
						isDefinedInComponentOrHook(path)
					) {
						const bodyPath = getBodyPath(path.get("init") as NodePath);
						functionRegistry.set(name, {
							name,
							node: init,
							path: path.get("init") as NodePath,
							isHook: false,
							bodyPath,
						});
					}

					// useCallback wrapped functions
					if (t.isCallExpression(init) && isUseCallbackCall(init)) {
						const callback = init.arguments[0];
						if (
							(t.isArrowFunctionExpression(callback) ||
								t.isFunctionExpression(callback)) &&
							isDefinedInComponentOrHook(path)
						) {
							const callbackPath = path.get("init.arguments.0") as NodePath;
							functionRegistry.set(name, {
								name,
								node: callback,
								path: callbackPath,
								isHook: true,
								bodyPath: getBodyPath(callbackPath),
							});
						}
					}
				}
			},

			// Find useEffect and useCallback calls and recursively process their callback bodies
			CallExpression(path) {
				// Process useEffect as the entry point
				if (isUseEffectCall(path.node)) {
					const callback = path.node.arguments[0];

					if (
						t.isArrowFunctionExpression(callback) ||
						t.isFunctionExpression(callback)
					) {
						const body = callback.body;
						const bodyPath = t.isBlockStatement(body)
							? (path.get("arguments.0.body") as NodePath<t.BlockStatement>)
							: null;

						if (bodyPath) {
							// Clear visited set for each useEffect
							const visitedFunctions = new Set<string>();

							// Use the recursive processing function
							const transformed = { value: false };
							processCallbackBody(
								bodyPath,
								setterNames,
								componentName,
								functionRegistry,
								visitedFunctions,
								transformed,
								instrumentedLocations,
							);

							if (transformed.value) {
								hasTransformed = true;
							}
						}
					}
				}

				// Also process useCallback directly (for cross-file calls)
				if (isUseCallbackCall(path.node)) {
					const callback = path.node.arguments[0];

					if (
						t.isArrowFunctionExpression(callback) ||
						t.isFunctionExpression(callback)
					) {
						const body = callback.body;
						const bodyPath = t.isBlockStatement(body)
							? (path.get("arguments.0.body") as NodePath<t.BlockStatement>)
							: null;

						if (bodyPath) {
							// Clear visited set for each useCallback
							const visitedFunctions = new Set<string>();

							// Use the recursive processing function
							const transformed = { value: false };
							processCallbackBody(
								bodyPath,
								setterNames,
								componentName,
								functionRegistry,
								visitedFunctions,
								transformed,
								instrumentedLocations,
							);

							if (transformed.value) {
								hasTransformed = true;
							}
						}
					}
				}
			},
		});

		// Process regular functions from custom hooks (not wrapped in useCallback)
		// This enables tracking setState in functions returned from custom hooks
		// Only process if we're in a custom hook (starts with "use")
		if (/^use[A-Z]/.test(componentName)) {
			for (const [_name, functionInfo] of functionRegistry.entries()) {
				if (!functionInfo.isHook && functionInfo.bodyPath) {
					// Clear visited set for each function
					const visitedFunctions = new Set<string>();

					// Use the recursive processing function
					const transformed = { value: false };
					processCallbackBody(
						functionInfo.bodyPath,
						setterNames,
						componentName,
						functionRegistry,
						visitedFunctions,
						transformed,
						instrumentedLocations,
					);

					if (transformed.value) {
						hasTransformed = true;
					}
				}
			}
		}

		// If no transformation was made, return null
		if (!hasTransformed) {
			return null;
		}

		// Add import if needed
		if (needsImport) {
			const importDeclaration = t.importDeclaration(
				[
					t.importSpecifier(
						t.identifier("__trackStateUpdate"),
						t.identifier("__trackStateUpdate"),
					),
				],
				t.stringLiteral("vite-plugin-butterfly-effect/runtime"),
			);
			ast.program.body.unshift(importDeclaration);
		}

		// Generate code from modified AST
		const output = generate(
			ast,
			{
				retainLines: true,
				compact: false,
			},
			code,
		);

		return {
			code: output.code,
			map: output.map,
		};
	} catch (error) {
		// If parsing fails, return null (don't transform)
		console.warn("Failed to parse React code:", error);
		return null;
	}
};

/**
 * Check if a function is likely a React component
 */
function isReactComponent(path: NodePath<t.FunctionDeclaration>): boolean {
	const name = path.node.id?.name;
	// React components start with uppercase letter
	return name ? /^[A-Z]/.test(name) : false;
}

/**
 * Check if a call expression is a useState call
 */
function isUseStateCall(node: t.Node | null | undefined): boolean {
	return (
		t.isCallExpression(node) &&
		t.isIdentifier(node.callee) &&
		node.callee.name === "useState"
	);
}

/**
 * Check if a call expression is a useEffect call
 */
function isUseEffectCall(node: t.CallExpression): boolean {
	return t.isIdentifier(node.callee) && node.callee.name === "useEffect";
}

/**
 * Check if a call expression is a useCallback call
 */
function isUseCallbackCall(node: t.CallExpression): boolean {
	return t.isIdentifier(node.callee) && node.callee.name === "useCallback";
}

/**
 * Check if a call expression is a setState call
 */
function isSetStateCall(
	node: t.CallExpression,
	setterNames: Set<string>,
): boolean {
	return t.isIdentifier(node.callee) && setterNames.has(node.callee.name);
}

/**
 * Extract setter name from array destructuring pattern
 * [count, setCount] -> "setCount"
 */
function extractSetterName(id: t.LVal): string | null {
	if (t.isArrayPattern(id) && id.elements.length >= 2) {
		const setter = id.elements[1];
		if (t.isIdentifier(setter)) {
			return setter.name;
		}
	}
	return null;
}

/**
 * Create a tracking call AST node
 * __trackStateUpdate({ componentName: 'App', line: 13, timestamp: Date.now() })
 */
function createTrackingCall(
	componentName: string,
	line: number,
): t.CallExpression {
	return t.callExpression(t.identifier("__trackStateUpdate"), [
		t.objectExpression([
			t.objectProperty(
				t.identifier("componentName"),
				t.stringLiteral(componentName),
			),
			t.objectProperty(t.identifier("line"), t.numericLiteral(line)),
			t.objectProperty(
				t.identifier("timestamp"),
				t.callExpression(
					t.memberExpression(t.identifier("Date"), t.identifier("now")),
					[],
				),
			),
		]),
	]);
}

/**
 * Check if a path is defined within a React component or custom hook scope
 */
function isDefinedInComponentOrHook(path: NodePath): boolean {
	let current = path.parentPath;
	while (current) {
		const node = current.node;

		// Check if we're inside a component or custom hook function
		if (
			t.isFunctionDeclaration(node) ||
			t.isFunctionExpression(node) ||
			t.isArrowFunctionExpression(node)
		) {
			// Found a function scope - check if it's a component or hook
			const parent = current.parent;
			if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
				const name = parent.id.name;
				// Component names start with uppercase, custom hooks start with "use"
				return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name);
			}
			if (t.isFunctionDeclaration(node) && node.id) {
				const name = node.id.name;
				return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name);
			}
		}

		current = current.parentPath;
	}
	return false;
}

/**
 * Get the body path of a function (handles both block and expression bodies)
 */
function getBodyPath(
	fnPath: NodePath,
): NodePath<t.BlockStatement> | NodePath | null {
	const node = fnPath.node;
	if (
		(t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) &&
		t.isBlockStatement(node.body)
	) {
		return fnPath.get("body") as NodePath<t.BlockStatement>;
	}
	// For arrow functions with expression bodies: () => setState(x)
	if (t.isArrowFunctionExpression(node) && !t.isBlockStatement(node.body)) {
		return fnPath.get("body") as NodePath;
	}
	return null;
}

/**
 * Recursively process a callback body to find and track setState calls,
 * including calls within nested functions
 */
function processCallbackBody(
	bodyPath: NodePath<t.BlockStatement> | NodePath,
	setterNames: Set<string>,
	componentName: string,
	functionRegistry: Map<string, FunctionInfo>,
	visitedFunctions: Set<string>,
	hasTransformed: { value: boolean },
	instrumentedLocations: Set<string>,
): void {
	// Handle expression bodies (arrow functions without block statement)
	if (!t.isBlockStatement(bodyPath.node)) {
		// Check if it's a direct setState call
		if (
			t.isCallExpression(bodyPath.node) &&
			isSetStateCall(bodyPath.node, setterNames)
		) {
			// This is a direct setState call in expression body
			// We can't inject tracking here easily, but mark as transformed
			hasTransformed.value = true;
			return;
		}

		// Check if it's a function call that might contain setState
		if (
			t.isCallExpression(bodyPath.node) &&
			t.isIdentifier(bodyPath.node.callee)
		) {
			const functionName = bodyPath.node.callee.name;
			const functionInfo = functionRegistry.get(functionName);

			if (functionInfo && !visitedFunctions.has(functionName)) {
				// Mark as visited to prevent cycles
				visitedFunctions.add(functionName);

				// Recursively process the called function's body
				if (functionInfo.bodyPath) {
					processCallbackBody(
						functionInfo.bodyPath,
						setterNames,
						componentName,
						functionRegistry,
						visitedFunctions,
						hasTransformed,
						instrumentedLocations,
					);
				}

				// Unmark after processing
				visitedFunctions.delete(functionName);
			}
		}
		return;
	}

	// For block statements, traverse all call expressions
	// Capture variables for use in traverse callback
	const _setterNames = setterNames;
	const _componentName = componentName;
	const _functionRegistry = functionRegistry;
	const _visitedFunctions = visitedFunctions;
	const _hasTransformed = hasTransformed;
	const _instrumentedLocations = instrumentedLocations;

	bodyPath.traverse({
		CallExpression(innerPath) {
			const callee = innerPath.node.callee;

			// Case 1: Direct setState call
			if (isSetStateCall(innerPath.node, _setterNames)) {
				const line = innerPath.node.loc?.start.line || 0;
				const column = innerPath.node.loc?.start.column || 0;
				const locationKey = `${line}:${column}`;

				// Skip if this location has already been instrumented
				if (_instrumentedLocations.has(locationKey)) {
					return;
				}

				const trackingCall = createTrackingCall(_componentName, line);

				const statement = innerPath.getStatementParent();
				if (statement) {
					statement.insertBefore(t.expressionStatement(trackingCall));
					_hasTransformed.value = true;
					// Mark this location as instrumented
					_instrumentedLocations.add(locationKey);
				}
				return;
			}

			// Case 2: Function call that might contain setState
			if (t.isIdentifier(callee)) {
				const functionName = callee.name;
				const functionInfo = _functionRegistry.get(functionName);

				if (functionInfo && !_visitedFunctions.has(functionName)) {
					// Mark as visited to prevent cycles
					_visitedFunctions.add(functionName);

					// Recursively process the called function's body
					if (functionInfo.bodyPath) {
						processCallbackBody(
							functionInfo.bodyPath,
							_setterNames,
							_componentName,
							_functionRegistry,
							_visitedFunctions,
							_hasTransformed,
							_instrumentedLocations,
						);
					}

					// Unmark after processing (allows same function in different branches)
					_visitedFunctions.delete(functionName);
				}
			}
		},
	});
}
