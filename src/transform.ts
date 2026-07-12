import generateDefault from "@babel/generator";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import traverseDefault from "@babel/traverse";
import * as t from "@babel/types";
import { EFFECT_ID_PREFIX, RUNTIME_MODULE } from "./constants";
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

const ORIGINAL_SETTER_PREFIX = "__butterfly_original_";
const BOUND_SETTER_PREFIX = "__bound_";
const RUNTIME_IMPORT_NAMES = ["__wrapSetter", "__wrapEffect"];

type SetterInfo = {
	name: string;
	line: number;
	declarationPath: NodePath<t.VariableDeclaration>;
	setterElement: t.Identifier;
	/** 名前一致ではなくスコープバインディング由来の参照。メンバー式の
	 *  プロパティやシャドーイングされたローカル変数を含まないため、
	 *  ここに含まれるIdentifierはそのままリネームしてよい */
	referencePaths: NodePath[];
};

type ComponentInfo = {
	name: string;
	setters: SetterInfo[];
	effects: NodePath<t.CallExpression>[];
};

export type TransformResult = {
	code: string;
	map: ReturnType<GenerateFunction>["map"];
};

export const transformReactCode = (
	code: string,
	id: string,
	options: TransformOptions,
): TransformResult | null => {
	const { trackState, trackEffect = true } = options;

	if (!trackState) {
		return null;
	}

	if (!code.includes("useState") && !code.includes("useEffect")) {
		return null;
	}

	try {
		const ast = parse(code, {
			sourceType: "module",
			plugins: ["jsx", "typescript"],
		});

		// 二重変換ガードを文字列一致にしないのは、ランタイムを正規に
		// importするユーザーファイル（ButterflyEvents購読など）まで
		// 誤ってスキップしてしまうため
		if (isAlreadyTransformed(ast)) {
			return null;
		}

		const components = collectComponents(ast);

		let hasSetterWrapping = false;
		let hasEffectWrapping = false;

		for (const info of components.values()) {
			// setterのリネームより先にeffectを処理する。逆順にすると
			// 収集済みreferencePathsが宣言リネーム後の古い情報になる
			for (const effectPath of trackEffect ? info.effects : []) {
				if (wrapUseEffectCallback(effectPath, info)) {
					hasEffectWrapping = true;
				}
			}

			for (const setter of info.setters) {
				wrapUseStateSetter(setter, info.name);
				hasSetterWrapping = true;
			}
		}

		if (!hasSetterWrapping && !hasEffectWrapping) {
			return null;
		}

		addRuntimeImports(ast, hasSetterWrapping, hasEffectWrapping);

		const output = generate(
			ast,
			{ sourceMaps: true, sourceFileName: id },
			code,
		);
		return { code: output.code, map: output.map };
	} catch (error) {
		console.error("[butterfly-effect] Transform error:", error);
		return null;
	}
};

const isAlreadyTransformed = (ast: t.File): boolean => {
	return ast.program.body.some(
		(node) =>
			t.isImportDeclaration(node) &&
			node.source.value === RUNTIME_MODULE &&
			node.specifiers.some(
				(specifier) =>
					t.isImportSpecifier(specifier) &&
					t.isIdentifier(specifier.imported) &&
					RUNTIME_IMPORT_NAMES.includes(specifier.imported.name),
			),
	);
};

const collectComponents = (ast: t.File): Map<t.Node, ComponentInfo> => {
	const components = new Map<t.Node, ComponentInfo>();

	traverse(ast, {
		CallExpression(path) {
			const callee = path.node.callee;
			const isUseState = t.isIdentifier(callee, { name: "useState" });
			const isUseEffect = t.isIdentifier(callee, { name: "useEffect" });
			if (!isUseState && !isUseEffect) return;

			// ファイル単位でコンポーネント名を1つ検出する方式は複数
			// コンポーネントで誤帰属するため、Rules of Hooksが保証する
			// 「フック呼び出しの最近傍の外側関数 = コンポーネント」で特定する
			const fnParent = path.getFunctionParent();
			if (!fnParent) return;

			let info = components.get(fnParent.node);
			if (!info) {
				info = {
					name: resolveFunctionName(fnParent) ?? "Unknown",
					setters: [],
					effects: [],
				};
				components.set(fnParent.node, info);
			}

			if (isUseState) {
				const setter = extractSetterInfo(path);
				if (setter) {
					info.setters.push(setter);
				}
			} else {
				info.effects.push(path);
			}
		},
	});

	return components;
};

/**
 * - function App() {} → "App"
 * - const App = () => {} → "App"
 * - const App = memo(() => {}) → "App"
 */
const resolveFunctionName = (fnPath: NodePath<t.Function>): string | null => {
	const node = fnPath.node;
	if (t.isFunctionDeclaration(node)) {
		return node.id?.name ?? null;
	}

	let current: NodePath | null = fnPath.parentPath;
	while (current) {
		// memo()/forwardRef()等のラップ越しに宣言名へ到達するため、
		// CallExpressionでは止まらず遡る
		if (current.isCallExpression()) {
			current = current.parentPath;
			continue;
		}
		if (current.isVariableDeclarator() && t.isIdentifier(current.node.id)) {
			return current.node.id.name;
		}
		break;
	}
	return null;
};

const extractSetterInfo = (
	callPath: NodePath<t.CallExpression>,
): SetterInfo | null => {
	const declarator = callPath.parentPath;
	if (!declarator?.isVariableDeclarator()) return null;

	const pattern = declarator.node.id;
	if (!t.isArrayPattern(pattern)) return null;
	if (pattern.elements.length < 2) return null;

	const setterElement = pattern.elements[1];
	if (!t.isIdentifier(setterElement)) return null;

	const declaration = declarator.parentPath;
	if (!declaration?.isVariableDeclaration()) return null;

	const binding = declarator.scope.getBinding(setterElement.name);
	// 同名の別バインディングを掴んでいたら、リネームすると無関係な
	// 参照を壊すため対象外にする
	if (!binding || binding.identifier !== setterElement) return null;

	return {
		name: setterElement.name,
		line: callPath.node.loc?.start.line ?? 0,
		declarationPath: declaration,
		setterElement,
		referencePaths: [...binding.referencePaths],
	};
};

/**
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
 * setterを使わないeffectを対象外にしないのは、effect外で定義された
 * コールバック経由のsetState呼び出しをランタイムのcurrentEffectId
 * フォールバックで帰属させるため
 */
const wrapUseEffectCallback = (
	callPath: NodePath<t.CallExpression>,
	info: ComponentInfo,
): boolean => {
	const callback = callPath.node.arguments[0];

	if (
		!t.isArrowFunctionExpression(callback) &&
		!t.isFunctionExpression(callback)
	) {
		return false;
	}

	const [callbackPath] = callPath.get("arguments");
	const line = callPath.node.loc?.start.line ?? 0;
	const effectId = `${EFFECT_ID_PREFIX}${info.name}_Line${line}`;

	const usedSetters: SetterInfo[] = [];
	for (const setter of info.setters) {
		let renamed = false;
		for (const ref of setter.referencePaths) {
			if (!ref.isIdentifier()) continue;
			if (!ref.isDescendant(callbackPath)) continue;
			ref.node.name = `${BOUND_SETTER_PREFIX}${setter.name}`;
			renamed = true;
		}
		if (renamed) {
			usedSetters.push(setter);
		}
	}

	if (usedSetters.length > 0) {
		injectEffectIdBinding(callback, effectId, usedSetters);
	}

	callPath.node.arguments[0] = t.callExpression(t.identifier("__wrapEffect"), [
		t.stringLiteral(effectId),
		callback,
	]);

	return true;
};

const injectEffectIdBinding = (
	callback: t.ArrowFunctionExpression | t.FunctionExpression,
	effectId: string,
	usedSetters: SetterInfo[],
) => {
	if (!t.isBlockStatement(callback.body)) {
		callback.body = t.blockStatement([t.returnStatement(callback.body)]);
	}

	const blockBody = callback.body as t.BlockStatement;

	const effectIdDeclaration = t.variableDeclaration("const", [
		t.variableDeclarator(
			t.identifier("__butterfly_effectId"),
			t.stringLiteral(effectId),
		),
	]);

	const boundSetterDeclarations: t.VariableDeclaration[] = usedSetters.map(
		(setter) =>
			t.variableDeclaration("const", [
				t.variableDeclarator(
					t.identifier(`${BOUND_SETTER_PREFIX}${setter.name}`),
					t.arrowFunctionExpression(
						[t.identifier("__v")],
						t.callExpression(t.identifier(setter.name), [
							t.identifier("__v"),
							t.identifier("__butterfly_effectId"),
						]),
					),
				),
			]),
	);

	blockBody.body.unshift(effectIdDeclaration, ...boundSetterDeclarations);
};

/**
 * 変換前:
 *   const [count, setCount] = useState(0);
 *
 * 変換後:
 *   const [count, __butterfly_original_setCount] = useState(0);
 *   const setCount = __wrapSetter(__butterfly_original_setCount, "App", 11);
 *
 * __wrapSetterはWeakMapでキャッシュされるため、レンダリングごとに
 * この式が再評価されてもsetterの参照は安定する（依存配列を壊さない）
 */
const wrapUseStateSetter = (setter: SetterInfo, componentName: string) => {
	const originalName = `${ORIGINAL_SETTER_PREFIX}${setter.name}`;

	setter.setterElement.name = originalName;

	const wrappedSetter = t.variableDeclaration("const", [
		t.variableDeclarator(
			t.identifier(setter.name),
			t.callExpression(t.identifier("__wrapSetter"), [
				t.identifier(originalName),
				t.stringLiteral(componentName),
				t.numericLiteral(setter.line),
			]),
		),
	]);

	setter.declarationPath.insertAfter(wrappedSetter);
};

const addRuntimeImports = (
	ast: t.File,
	hasSetterWrapping: boolean,
	hasEffectWrapping: boolean,
) => {
	const imports: t.ImportSpecifier[] = [];

	if (hasSetterWrapping) {
		imports.push(
			t.importSpecifier(
				t.identifier("__wrapSetter"),
				t.identifier("__wrapSetter"),
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
		t.stringLiteral(RUNTIME_MODULE),
	);

	ast.program.body.unshift(importDeclaration);
};
