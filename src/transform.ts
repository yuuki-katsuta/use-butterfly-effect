import generateDefault from "@babel/generator";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import traverseDefault from "@babel/traverse";
import * as t from "@babel/types";
import type { ButterflyEffectOptions } from "./types";

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

// コンポーネントごとのsetter名を追跡
type SetterInfo = {
	name: string;
	originalName: string;
	line: number;
};

/**
 * Reactコードを変換
 * - 1. 全てのuseStateのsetterをトラッキングコードでラップ（effectIdパラメータ付き）
 * - 2. 全てのuseEffectコールバック内でsetterをバインド版に置換
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
		const componentName = detectComponentName(code, ast);

		// コンポーネント内のsetter情報を収集
		const setterInfos: SetterInfo[] = [];
		let hasEffectWrapping = false;

		// 1. 全てのuseStateのsetterをラップ
		traverse(ast, {
			CallExpression(path) {
				if (isUseStateCall(path.node)) {
					const info = wrapUseStateSetter(path, componentName);
					if (info) {
						setterInfos.push(info);
						hasSetterWrapping = true;
					}
				}
			},
		});

		// 2. 全てのuseEffectコールバックをラップ
		traverse(ast, {
			CallExpression(path) {
				if (isUseEffectCall(path.node)) {
					const wrapped = wrapUseEffectCallback(
						path,
						componentName,
						setterInfos,
					);
					if (wrapped) {
						hasEffectWrapping = true;
					}
				}
			},
		});

		// 変換が何も行われなかった場合はnullを返す
		if (!hasSetterWrapping && !hasEffectWrapping) {
			return null;
		}

		// 変換を行った場合はランタイムインポートを追加
		addRuntimeImports(ast, hasSetterWrapping, hasEffectWrapping);

		const output = generate(ast, {}, code);
		return { code: output.code, map: null };
	} catch (error) {
		console.error("[butterfly-effect] Transform error:", error);
		return null;
	}
};

/**
 * コードからコンポーネント名を検出
 * Reactコンポーネントの関数宣言やconst宣言を探す
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
 *   const setCount = (__butterfly_value, __butterfly_effectId) => {
 *     __trackStateUpdate({ componentName: "App", line: 11, timestamp: Date.now(), effectId: __butterfly_effectId });
 *     return __butterfly_original_setCount(__butterfly_value);
 *   };
 */
const wrapUseStateSetter = (
	callPath: NodePath<t.CallExpression>,
	componentName: string,
): SetterInfo | null => {
	const parent = callPath.parent;

	// const [state, setState] = useState(...) の形式である必要がある
	if (!t.isVariableDeclarator(parent)) return null;
	if (!t.isArrayPattern(parent.id)) return null;
	if (parent.id.elements.length < 2) return null;

	const setterElement = parent.id.elements[1];
	if (!t.isIdentifier(setterElement)) return null;

	const setterName = setterElement.name;
	const originalSetterName = `__butterfly_original_${setterName}`;
	const line = callPath.node.loc?.start.line || 0;

	// 1. 分割代入パターン内のsetterをリネーム
	parent.id.elements[1] = t.identifier(originalSetterName);

	// 2. ラップされたsetter関数を作成
	const wrappedSetter = t.variableDeclaration("const", [
		t.variableDeclarator(
			t.identifier(setterName),
			t.arrowFunctionExpression(
				// パラメータ: (__butterfly_value, __butterfly_effectId)
				[
					t.identifier("__butterfly_value"),
					t.identifier("__butterfly_effectId"),
				],
				t.blockStatement([
					// __trackStateUpdate({ componentName, line, timestamp, effectId })
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
								t.objectProperty(
									t.identifier("effectId"),
									t.identifier("__butterfly_effectId"),
								),
							]),
						]),
					),
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

	// 3. useState宣言の直後にラップされたsetterを挿入
	const variableDeclarationPath = callPath.findParent((p) =>
		p.isVariableDeclaration(),
	) as NodePath<t.VariableDeclaration> | null;

	if (variableDeclarationPath) {
		variableDeclarationPath.insertAfter(wrappedSetter);
	}

	return {
		name: setterName,
		originalName: originalSetterName,
		line,
	};
};

/**
 * useEffectコールバックを__wrapEffectでラップ
 *
 * 変換前:
 *   useEffect(() => {
 *     setCount(1);
 *   }, []);
 *
 * 変換後:
 *   useEffect(__wrapEffect("Effect_App_Line5", () => {
 *     const __butterfly_effectId = "Effect_App_Line5";
 *     const __bound_setCount = __v => setCount(__v, __butterfly_effectId);
 *     __bound_setCount(1);
 *   }), []);
 *
 */
const wrapUseEffectCallback = (
	callPath: NodePath<t.CallExpression>,
	componentName: string,
	setterInfos: SetterInfo[],
): boolean => {
	const callback = callPath.node.arguments[0];

	if (
		!t.isArrowFunctionExpression(callback) &&
		!t.isFunctionExpression(callback)
	) {
		return false;
	}

	const line = callPath.node.loc?.start.line || 0;
	const effectId = `Effect_${componentName}_Line${line}`;

	// effect内で使用されているsetterを検出
	const usedSetters = findUsedSetters(callback, setterInfos);

	// Closure Binding: setterにeffectIdをバインド
	if (usedSetters.length > 0) {
		// 先にsetter参照を置換してから、bound setter宣言を注入
		const callbackPath = callPath.get("arguments.0") as NodePath<
			t.ArrowFunctionExpression | t.FunctionExpression
		>;
		replaceSetterReferences(callbackPath, usedSetters);

		// bound setter宣言を先頭に注入
		injectEffectIdBinding(callback, effectId, usedSetters);
	}

	// コールバックを__wrapEffectでラップ
	callPath.node.arguments[0] = t.callExpression(t.identifier("__wrapEffect"), [
		t.stringLiteral(effectId),
		callback,
	]);

	return true;
};

/**
 * コールバック内にeffectIdとバインド版setterを注入
 */
const injectEffectIdBinding = (
	callback: t.ArrowFunctionExpression | t.FunctionExpression,
	effectId: string,
	usedSetters: SetterInfo[],
) => {
	const body = callback.body;

	// 式をブロック文に変換
	if (!t.isBlockStatement(body)) {
		callback.body = t.blockStatement([t.returnStatement(body)]);
	}

	const blockBody = callback.body as t.BlockStatement;

	// effectId定数
	const effectIdDeclaration = t.variableDeclaration("const", [
		t.variableDeclarator(
			t.identifier("__butterfly_effectId"),
			t.stringLiteral(effectId),
		),
	]);

	// バインド版setter
	const boundSetterDeclarations: t.VariableDeclaration[] = usedSetters.map(
		(setter) => {
			const boundName = `__bound_${setter.name}`;
			return t.variableDeclaration("const", [
				t.variableDeclarator(
					t.identifier(boundName),
					t.arrowFunctionExpression(
						[t.identifier("__v")],
						t.callExpression(t.identifier(setter.name), [
							t.identifier("__v"),
							t.identifier("__butterfly_effectId"),
						]),
					),
				),
			]);
		},
	);

	// 先頭に挿入
	blockBody.body.unshift(effectIdDeclaration, ...boundSetterDeclarations);
};

/**
 * effect内で使用されているsetterを検出
 */
const findUsedSetters = (
	callback: t.ArrowFunctionExpression | t.FunctionExpression,
	setterInfos: SetterInfo[],
): SetterInfo[] => {
	const usedSetters: SetterInfo[] = [];
	const setterNames = new Set(setterInfos.map((s) => s.name));

	const checkNode = (node: t.Node) => {
		if (t.isIdentifier(node) && setterNames.has(node.name)) {
			const setter = setterInfos.find((s) => s.name === node.name);
			if (setter && !usedSetters.includes(setter)) {
				usedSetters.push(setter);
			}
		}
	};

	// ASTを走査してsetter参照を探す
	const walkNode = (node: t.Node | null | undefined) => {
		if (!node) return;

		checkNode(node);

		// 子ノードを走査
		for (const key of Object.keys(node)) {
			const child = (node as any)[key];
			if (Array.isArray(child)) {
				for (const item of child) {
					if (item && typeof item === "object" && item.type) {
						walkNode(item);
					}
				}
			} else if (child && typeof child === "object" && child.type) {
				walkNode(child);
			}
		}
	};

	walkNode(callback.body);
	return usedSetters;
};

/**
 * setter参照をバインド版に置換
 */
const replaceSetterReferences = (
	callbackPath: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
	usedSetters: SetterInfo[],
) => {
	const setterNameMap = new Map(
		usedSetters.map((s) => [s.name, `__bound_${s.name}`]),
	);

	callbackPath.traverse({
		Identifier(path) {
			const boundName = setterNameMap.get(path.node.name);
			if (!boundName) return;

			// バインド版の宣言自体は置換しない
			if (t.isVariableDeclarator(path.parent) && path.parent.id === path.node) {
				return;
			}

			// オブジェクトプロパティのキーは置換しない
			if (
				t.isObjectProperty(path.parent) &&
				path.parent.key === path.node &&
				!path.parent.computed
			) {
				return;
			}

			// setter名をバインド版に置換
			path.node.name = boundName;
		},
	});
};

/**
 * ASTにランタイムインポートを追加
 */
const addRuntimeImports = (
	ast: t.File,
	hasSetterWrapping: boolean,
	hasEffectWrapping: boolean,
) => {
	const imports: t.ImportSpecifier[] = [];

	if (hasSetterWrapping) {
		imports.push(
			t.importSpecifier(
				t.identifier("__trackStateUpdate"),
				t.identifier("__trackStateUpdate"),
			),
		);
	}

	if (hasEffectWrapping) {
		imports.push(
			t.importSpecifier(
				t.identifier("__wrapEffect"),
				t.identifier("__wrapEffect"),
			),
		);
	}

	if (imports.length === 0) return;

	const importDeclaration = t.importDeclaration(
		imports,
		t.stringLiteral("vite-plugin-butterfly-effect/runtime"),
	);

	// ファイルの先頭に挿入
	ast.program.body.unshift(importDeclaration);
};
