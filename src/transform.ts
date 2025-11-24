import generateDefault from "@babel/generator";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import traverseDefault from "@babel/traverse";
import * as t from "@babel/types";
import type { ButterflyEffectOptions } from "./types";

// ESMとCJSの両方のデフォルトエクスポートに対応
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
 * "全てのSetterをラップ + Effectをマーク" アプローチでReactコードを変換
 * - 1. 全てのuseStateのsetterをトラッキングコードでラップ
 * - 2. 全てのuseEffectコールバックを __enterEffect/__exitEffect でラップ
 */
export const transformReactCode = (
	code: string,
	_id: string,
	_projectRoot: string,
	options: TransformOptions,
) => {
	const { trackState } = options;

	if (!trackState) {
		return null;
	}

	// Reactフックが存在しない場合
	if (!code.includes("useState") && !code.includes("useEffect")) {
		return null;
	}

	try {
		const ast = parse(code, {
			sourceType: "module",
			plugins: ["jsx", "typescript"],
		});

		let hasSetterWrapping = false;
		let hasEffectWrapping = false;
		const componentName = detectComponentName(code, ast);

		// 1. 全てのuseStateのsetterをラップ
		traverse(ast, {
			CallExpression(path) {
				if (isUseStateCall(path.node)) {
					wrapUseStateSetter(path, componentName);
					hasSetterWrapping = true;
				}
			},
		});

		// 2. 全てのuseEffectコールバックをラップ
		traverse(ast, {
			CallExpression(path) {
				if (isUseEffectCall(path.node)) {
					wrapUseEffectCallback(path, componentName);
					hasEffectWrapping = true;
				}
			},
		});

		// 変換が何も行われなかった場合はnullを返す
		if (!hasSetterWrapping && !hasEffectWrapping) {
			return null;
		}

		// 変換を行った場合はランタイムインポートを追加
		if (hasSetterWrapping || hasEffectWrapping) {
			addRuntimeImports(ast, hasSetterWrapping, hasEffectWrapping);
		}

		const output = generate(ast, {}, code);
		return { code: output.code, map: null };
	} catch (error) {
		console.error("[butterfly-effect] Transform error:", error);
		return null;
	}
};

/**
 * コードからコンポーネント名を検出
 * Reactコンポーネントらしき関数宣言やconst宣言を探す
 */
const detectComponentName = (_code: string, ast: t.File): string => {
	let componentName = "Unknown";

	traverse(ast, {
		FunctionDeclaration(path) {
			if (isReactComponent(path)) {
				componentName = path.node.id?.name || "Unknown";
			}
		},
		VariableDeclarator(path) {
			if (
				t.isIdentifier(path.node.id) &&
				(t.isArrowFunctionExpression(path.node.init) ||
					t.isFunctionExpression(path.node.init))
			) {
				const name = path.node.id.name;
				// Reactコンポーネントは通常、大文字始まりか"use"で始まる
				if (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) {
					componentName = name;
				}
			}
		},
	});

	return componentName;
};

/**
 * 関数宣言がReactコンポーネントかどうかをチェック
 */
const isReactComponent = (path: NodePath<t.FunctionDeclaration>): boolean => {
	const name = path.node.id?.name;
	if (!name) return false;

	// Reactコンポーネントは大文字で始まる
	if (!/^[A-Z]/.test(name)) return false;

	// 本体にJSXかフックが含まれているべき
	let hasReactFeatures = false;
	path.traverse({
		JSXElement() {
			hasReactFeatures = true;
		},
		CallExpression(callPath) {
			const callee = callPath.node.callee;
			if (t.isIdentifier(callee) && /^use[A-Z]/.test(callee.name)) {
				hasReactFeatures = true;
			}
		},
	});

	return hasReactFeatures;
};

/**
 * 関数呼び出しがuseState()かどうかをチェック
 */
const isUseStateCall = (node: t.CallExpression): boolean => {
	return t.isIdentifier(node.callee) && node.callee.name === "useState";
};

/**
 * 関数呼び出しがuseEffect()かどうかをチェック
 */
const isUseEffectCall = (node: t.CallExpression): boolean => {
	return t.isIdentifier(node.callee) && node.callee.name === "useEffect";
};

/**
 * useStateのsetterをトラッキングコードでラップする
 *
 * 変換前:
 *   const [count, setCount] = useState(0);
 *
 * 変換後:
 *   const [count, __butterfly_original_setCount] = useState(0);
 *   const setCount = (__butterfly_value) => {
 *     __trackStateUpdate({ componentName: "App", line: 11, timestamp: Date.now() });
 *     return __butterfly_original_setCount(__butterfly_value);
 *   };
 */
const wrapUseStateSetter = (
	callPath: NodePath<t.CallExpression>,
	componentName: string,
) => {
	const parent = callPath.parent;

	// const [state, setState] = useState(...) の形式である必要がある
	if (!t.isVariableDeclarator(parent)) return;
	if (!t.isArrayPattern(parent.id)) return;
	if (parent.id.elements.length < 2) return;

	const setterElement = parent.id.elements[1];
	if (!t.isIdentifier(setterElement)) return;

	const setterName = setterElement.name;
	const originalSetterName = `__butterfly_original_${setterName}`;
	const line = callPath.node.loc?.start.line || 0;

	// 1. 分割代入パターン内のsetterをリネーム
	parent.id.elements[1] = t.identifier(originalSetterName);

	// 2. ラップされたsetter関数を作成
	// 関数定義をASTで組み立てる
	const wrappedSetter = t.variableDeclaration("const", [
		t.variableDeclarator(
			// 左辺
			t.identifier(setterName),
			// 右辺
			t.arrowFunctionExpression(
				// パラメータ
				[t.identifier("__butterfly_value")],
				// 関数本体
				t.blockStatement([
					// __trackStateUpdate({ componentName: "App", line: 11, timestamp: Date.now() }); を構成
					t.expressionStatement(
						t.callExpression(t.identifier("__trackStateUpdate"), [
							t.objectExpression([
								t.objectProperty(
									t.identifier("componentName"),
									t.stringLiteral(componentName),
								),
								t.objectProperty(t.identifier("line"), t.numericLiteral(line)),
								t.objectProperty(
									t.identifier("timestamp"),
									t.callExpression(
										t.memberExpression(
											t.identifier("Date"),
											t.identifier("now"),
										),
										[],
									),
								),
							]),
						]),
					),
					// setter関数をreturnする
					// return __butterfly_original_setCount(__butterfly_value);
					t.returnStatement(
						t.callExpression(t.identifier(originalSetterName), [
							t.identifier("__butterfly_value"),
						]),
					),
				]),
			),
		),
	]);

	// 3. useState宣言の直後にラップされたsetterを挿入（新しいノードを追加）
	const variableDeclarationPath = callPath.findParent((p) =>
		p.isVariableDeclaration(),
	) as NodePath<t.VariableDeclaration> | null;

	if (variableDeclarationPath) {
		variableDeclarationPath.insertAfter(wrappedSetter);
	}
};

/**
 * useEffectコールバックを ButterflyContext.enter/exit でラップ
 *
 * 変換前:
 *   useEffect(() => {
 *     async function fetch() {
 *       const data = await fetchAPI();
 *       setCount(data);
 *     }
 *     fetch();
 *   }, []);
 *
 * 変換後:
 *   useEffect(() => {
 *     const __butterfly_effectId = "Effect_App_Line42";
 *     ButterflyContext.enter(__butterfly_effectId);
 *     try {
 *       async function fetch() {
 *         const data = await fetchAPI();
 *         setCount(data); // ✅ Tracked even after await!
 *       }
 *       fetch();
 *     } finally {}
 *     return () => {
 *       ButterflyContext.exit();
 *     };
 *   }, []);
 */
const wrapUseEffectCallback = (
	callPath: NodePath<t.CallExpression>,
	componentName: string,
) => {
	const callback = callPath.node.arguments[0];

	if (
		!t.isArrowFunctionExpression(callback) &&
		!t.isFunctionExpression(callback)
	) {
		return;
	}

	const body = callback.body;
	const line = callPath.node.loc?.start.line || 0;

	// effectIdを生成
	const effectId = `Effect_${componentName}_Line${line}`;

	// ブロック文と式の両方に対応
	let statements: t.Statement[];

	if (t.isBlockStatement(body)) {
		statements = body.body;
	} else {
		// 式をreturn文に変換
		statements = [t.returnStatement(body)];
	}

	// 元のコールバックにcleanup関数が含まれているかチェック
	let existingCleanupStatements: t.Statement[] = [];

	if (t.isBlockStatement(body)) {
		const lastStatement = statements[statements.length - 1];
		if (t.isReturnStatement(lastStatement) && lastStatement.argument) {
			const returnArg = lastStatement.argument;

			// 既存のcleanup関数の本体を取得
			if (
				t.isArrowFunctionExpression(returnArg) ||
				t.isFunctionExpression(returnArg)
			) {
				const cleanupBody = returnArg.body;
				if (t.isBlockStatement(cleanupBody)) {
					existingCleanupStatements = cleanupBody.body;
				} else {
					// 式の場合は式文に変換
					existingCleanupStatements = [t.expressionStatement(cleanupBody)];
				}
			}

			// 元のreturn文を削除
			statements = statements.slice(0, -1);
		}
	}

	// 新しいcleanup関数を作成（ButterflyContext.exit + 既存cleanup）
	const cleanupStatements = [
		t.expressionStatement(
			t.callExpression(
				t.memberExpression(
					t.identifier("ButterflyContext"),
					t.identifier("exit"),
				),
				[],
			),
		),
		...existingCleanupStatements,
	];

	const cleanupFunction = t.arrowFunctionExpression(
		[],
		t.blockStatement(cleanupStatements),
	);

	// ButterflyContext.enter/exit でラップ
	const wrappedBody = t.blockStatement([
		// const __butterfly_effectId = "Effect_ComponentName_Line42";
		t.variableDeclaration("const", [
			t.variableDeclarator(
				t.identifier("__butterfly_effectId"),
				t.stringLiteral(effectId),
			),
		]),
		// ButterflyContext.enter(__butterfly_effectId);
		t.expressionStatement(
			t.callExpression(
				t.memberExpression(
					t.identifier("ButterflyContext"),
					t.identifier("enter"),
				),
				[t.identifier("__butterfly_effectId")],
			),
		),
		// try { 元の処理 } finally { queueMicrotask(() => ButterflyContext.clearSync()) }
		t.tryStatement(
			t.blockStatement(statements),
			null,
			t.blockStatement([
				// queueMicrotask(() => ButterflyContext.clearSync());
				t.expressionStatement(
					t.callExpression(t.identifier("queueMicrotask"), [
						t.arrowFunctionExpression(
							[],
							t.callExpression(
								t.memberExpression(
									t.identifier("ButterflyContext"),
									t.identifier("clearSync"),
								),
								[],
							),
						),
					]),
				),
			]),
		),
		// return () => { ButterflyContext.exit(); 既存cleanup };
		t.returnStatement(cleanupFunction),
	]);

	callback.body = wrappedBody;
};

/**
 * ASTにランタイムインポートを追加
 *
 * 変換前:
 *  import { useState, useEffect } from "react";
 *
 *  function App() {
 *    const [count, setCount] = useState(0);
 *    useEffect(() => {
 *      setCount(1);
 *    }, []);
 *  }
 *
 * 変換後:
 *  import { __trackStateUpdate, __enterEffect, __exitEffect } from "vite-plugin-butterfly-effect/runtime";
 *	import { useState, useEffect } from "react";
 *
 *	function App() {
 *		const [count, __butterfly_original_setCount] = useState(0);
 *		const setCount = (__butterfly_value) => {
 *			__trackStateUpdate({ ... });  // importが必要
 *			return __butterfly_original_setCount(__butterfly_value);
 *		};
 *
 *		useEffect(() => {
 *			__enterEffect();  // importが必要
 *			try {
 *				setCount(1);
 *			} finally {
 *				__exitEffect();  // importが必要
 *			}
 *		}, []);
 *	}
 */
const addRuntimeImports = (
	ast: t.File,
	hasSetterWrapping: boolean,
	hasEffectWrapping: boolean,
) => {
	const imports: t.Identifier[] = [];

	if (hasSetterWrapping) {
		imports.push(t.identifier("__trackStateUpdate"));
	}

	if (hasEffectWrapping) {
		imports.push(t.identifier("ButterflyContext"));
	}

	if (imports.length === 0) return;

	const importDeclaration = t.importDeclaration(
		imports.map((id) => t.importSpecifier(id, id)),
		t.stringLiteral("vite-plugin-butterfly-effect/runtime"),
	);

	// ファイルの先頭に挿入
	ast.program.body.unshift(importDeclaration);
};
