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

	if (!code.includes("useState")) {
		return null;
	}

	try {
		const ast = parse(code, {
			sourceType: "module",
			plugins: ["jsx", "typescript"],
		});

		// useStateのset関数名を格納
		const setterNames = new Set<string>();
		let componentName = "Unknown";
		let hasTransformed = false;
		const needsImport = !code.includes("__trackStateUpdate");

		// useEffect内で呼ばれる関数を追跡するための辞書
		const functionRegistry = new Map<string, FunctionInfo>();

		// Track instrumented locations to prevent duplicate injections
		// Key format: "line:column"
		const instrumentedLocations = new Set<string>();

		traverse(ast, {
			// Handle: function handleClick() { ... }
			// `function`キーワードで定義された関数宣言を検出
			FunctionDeclaration(path) {
				// === Reactコンポーネント名を登録 ===
				if (isReactComponent(path)) {
					componentName = path.node.id?.name || "Unknown";
				}

				// === functionRegistry への登録 ===
				// この関数がReactコンポーネント/カスタムフック内で定義されているかチェック
				// function MyComponent()のようなReactコンポーネントは登録されない
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

			// 変数宣言の右辺を検出
			VariableDeclarator(path) {
				// アロー関数/関数式で定義された React コンポーネント/カスタムフックの名前を取得
				if (
					t.isIdentifier(path.node.id) &&
					(t.isArrowFunctionExpression(path.node.init) ||
						t.isFunctionExpression(path.node.init))
				) {
					const name = path.node.id.name;
					if (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) {
						componentName = name;
					}
				}

				// === セッター関数登録 ===

				// Extract useState setter names
				// const [count, setCount] = useState(0);
				// useStateの左辺が有効な代入先かをチェック
				if (isUseStateCall(path.node.init) && t.isLVal(path.node.id)) {
					const setter = extractSetterName(path.node.id);
					if (setter) {
						setterNames.add(setter);
					}
				}

				// === functionRegistry への登録 ===

				if (t.isIdentifier(path.node.id)) {
					const name = path.node.id.name;
					const init = path.node.init;

					// function宣言、関数式を登録
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

					// useCallbackでラップされた関数を登録
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

			// 関数呼び出しを検出する
			CallExpression(path) {
				// useEffectを検出
				if (isUseEffectCall(path.node)) {
					// 第1引数（コールバック関数）を取得
					const callback = path.node.arguments[0];

					// コールバック関数かチェック
					if (
						t.isArrowFunctionExpression(callback) ||
						t.isFunctionExpression(callback)
					) {
						// 関数のbody内を再起的に処理してトラッキング
						const body = callback.body;
						const bodyPath = t.isBlockStatement(body)
							? (path.get("arguments.0.body") as NodePath<t.BlockStatement>)
							: null;

						if (bodyPath) {
							// 訪問済みとしてマークするための辞書
							const visitedFunctions = new Set<string>();

							// 変換が発生したかのフラグ
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

				// useCallbackの検出
				// この記述は全てをトラッキングしてしまうので不要です
				// if (isUseCallbackCall(path.node)) {
				// 	// 第1引数（コールバック関数）を取得
				// 	const callback = path.node.arguments[0];

				// 	// コールバック関数かチェック
				// 	if (
				// 		t.isArrowFunctionExpression(callback) ||
				// 		t.isFunctionExpression(callback)
				// 	) {
				// 		// 関数のbody内を再起的に処理してトラッキング
				// 		const body = callback.body;
				// 		const bodyPath = t.isBlockStatement(body)
				// 			? (path.get("arguments.0.body") as NodePath<t.BlockStatement>)
				// 			: null;

				// 		if (bodyPath) {
				// 			// 訪問済みとしてマークするための辞書
				// 			const visitedFunctions = new Set<string>();

				// 			// 変換が発生したかのフラグ
				// 			const transformed = { value: false };
				// 			processCallbackBody(
				// 				bodyPath,
				// 				setterNames,
				// 				componentName,
				// 				functionRegistry,
				// 				visitedFunctions,
				// 				transformed,
				// 				instrumentedLocations,
				// 			);

				// 			if (transformed.value) {
				// 				hasTransformed = true;
				// 			}
				// 		}
				// 	}
				// }
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
		// 状態更新関数を抽出
		const setter = id.elements[1];
		if (t.isIdentifier(setter)) {
			return setter.name;
		}
	}

	return null;
}

/**
 * トラッキング用の関数呼び出しの AST ノードを生成
 * 生成される AST:
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
 * 指定された ASTノードがReact コンポーネントまたはカスタムフック内で定義されているかどうかを判定
 */
function isDefinedInComponentOrHook(path: NodePath): boolean {
	// 親を辿る
	let current = path.parentPath;
	while (current) {
		const node = current.node;

		// 関数スコープを発見
		if (
			t.isFunctionDeclaration(node) ||
			t.isFunctionExpression(node) ||
			t.isArrowFunctionExpression(node)
		) {
			// 名前が大文字で始まる or "use"+大文字 の場合、
			const parent = current.parent;
			if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
				const name = parent.id.name;
				return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name);
			}
			if (t.isFunctionDeclaration(node) && node.id) {
				const name = node.id.name;
				return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name);
			}
		}

		// 関数スコープが見つからない場合、さらに親を辿る
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
 * useEffect のコールバック関数の body を再帰的に処理し、setState 呼び出しにトラッキングコードを注入する
 * 以下の処理を行う:
 * 1. 直接的な setState 呼び出しを検出してトラッキングコードを注入
 * 2. functionRegistry に登録された関数呼び出しを検出し、その中身を再帰的に処理
 * 3. 循環参照を visitedFunctions で追跡して無限ループを防止
 * 4. 重複注入を instrumentedLocations で防止
 *
 * @param bodyPath - 処理対象の関数 body の AST path (BlockStatement または Expression)
 * @param setterNames - setState 関数名のセット (例: "setCount")
 * @param componentName - トラッキングコードに記録するコンポーネント名
 * @param functionRegistry - コンポーネント/フック内で定義された関数の登録情報
 * @param visitedFunctions - 循環参照防止のための訪問済み関数名のセット（再帰呼び出し中に共有される）
 * @param hasTransformed - 変換が発生したかを記録するフラグ（参照渡しのためオブジェクト）
 * @param instrumentedLocations - トラッキングコードを注入済みの位置（"line:column" 形式）のセット
 *
 * @example
 * // 処理対象のコード
 * useEffect(() => {
 *   setCount(0);      // ← 直接呼び出し: トラッキング注入
 *   updateCount();    // ← 間接呼び出し: functionRegistry から取得して再帰処理
 * }, []);
 *
 * // 変換後
 * useEffect(() => {
 *   __trackStateUpdate('setCount', 'MyComponent', 123, 45);
 *   setCount(0);
 *   updateCount();  // ← この中の setState もトラッキングされる
 * }, []);
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
	// BlockStatementとそうでない場合で、トラッキングコードの注入難易度が変わる

	// NOTE：
	// 現在の実装ではBlockStatementではない場合（中括弧なし）に対応していない
	// 将来的に対応する予定

	// BlockStatementではない場合のbody処理
	// 例：useEffect(() => setCount(0), []);
	if (!t.isBlockStatement(bodyPath.node)) {
		// 直接的なset関数の呼び出し
		if (
			t.isCallExpression(bodyPath.node) &&
			isSetStateCall(bodyPath.node, setterNames)
		) {
			// 変換フラグを有効にする
			hasTransformed.value = true;

			return;
		}

		// set関数を含む可能性のある関数呼び出し
		if (
			t.isCallExpression(bodyPath.node) &&
			t.isIdentifier(bodyPath.node.callee)
		) {
			const functionName = bodyPath.node.callee.name;
			const functionInfo = functionRegistry.get(functionName);

			// 登録済みの関数である場合
			if (functionInfo && !visitedFunctions.has(functionName)) {
				// 循環参照を防ぐために訪問済みとしてマークする
				visitedFunctions.add(functionName);

				// 関数の中身を再起的に処理
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

				// 処理終了後に訪問済みマークを解除
				visitedFunctions.delete(functionName);
			}
		}

		return;
	}

	// ブロック文の場合、全ての関数呼び出しを走査
	// 例：useEffect(() => {setCount(0), ...}, []);
	// traverse のコールバック内で使用するために変数をキャプチャ
	const _setterNames = setterNames;
	const _componentName = componentName;
	const _functionRegistry = functionRegistry;
	const _visitedFunctions = visitedFunctions;
	const _hasTransformed = hasTransformed;
	const _instrumentedLocations = instrumentedLocations;

	// AST の特定ノード配下を走査する
	bodyPath.traverse({
		// 関数呼び出し
		CallExpression(innerPath) {
			const callee = innerPath.node.callee;

			// 直接的なset関数の呼び出し
			if (isSetStateCall(innerPath.node, _setterNames)) {
				const line = innerPath.node.loc?.start.line || 0;
				const column = innerPath.node.loc?.start.column || 0;
				const locationKey = `${line}:${column}`;

				// すでにトラッキングコードが注入されている場合はスキップ
				if (_instrumentedLocations.has(locationKey)) {
					return;
				}

				const trackingCall = createTrackingCall(_componentName, line);
				// 最も近い親の文（Statement=プログラムの実行単位）を取得
				// トラッキングコードを挿入する位置を特定するために必要
				const statement = innerPath.getStatementParent();
				if (statement) {
					// トラッキングコードを挿入
					statement.insertBefore(t.expressionStatement(trackingCall));
					_hasTransformed.value = true;
					// この位置を注入済みとしてマーク
					_instrumentedLocations.add(locationKey);
				}

				return;
			}

			// set関数を含む可能性のある関数呼び出し
			if (t.isIdentifier(callee)) {
				const functionName = callee.name;
				const functionInfo = _functionRegistry.get(functionName);

				if (functionInfo && !_visitedFunctions.has(functionName)) {
					// 循環参照を防ぐために訪問済みとしてマークする
					_visitedFunctions.add(functionName);

					// 関数の中身を再起的に処理
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

					// 処理終了後に訪問済みマークを解除
					_visitedFunctions.delete(functionName);
				}
			}
		},
	});
}
