import generateDefault from "@babel/generator";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import traverseDefault from "@babel/traverse";
import * as t from "@babel/types";
import { EFFECT_ID_PREFIX, RUNTIME_MODULE } from "./constants.js";
import type { ButterflyEffectOptions } from "./types.js";

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
const INSTANCE_NAME = "__butterfly_inst";
const USE_REF_ALIAS = "__butterfly_useRef";
const RUNTIME_IMPORT_NAMES = ["__wrapSetter", "__wrapEffect", "__captureDeps"];

type SetterInfo = {
	name: string;
	line: number;
	stateId: string;
	declarationPath: NodePath<t.VariableDeclaration>;
	setterElement: t.Identifier;
	/** 分割代入の第1要素（state変数）。deps内の識別子とstateを対応付ける
	 *  ために持つ。ホールパターン([, setX])ではnull */
	stateElement: t.Identifier | null;
	/** 名前一致ではなくスコープバインディング由来の参照。メンバー式の
	 *  プロパティやシャドーイングされたローカル変数を含まないため、
	 *  ここに含まれるIdentifierはそのままリネームしてよい */
	referencePaths: NodePath[];
};

type ComponentInfo = {
	name: string;
	tag: string;
	fnPath: NodePath<t.Function>;
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

		// コンポーネント名+行番号だけのIDは別ファイルの同名コンポーネント
		// (index.tsx慣習など)と衝突して偽の因果が繋がるため、
		// モジュールパスのハッシュで名前空間を分ける
		const tag = moduleTag(id);
		const components = collectComponents(ast, tag);

		let hasSetterWrapping = false;
		let hasEffectWrapping = false;
		let hasDepsCapture = false;
		let hasInstanceRef = false;

		for (const info of components.values()) {
			// deps記録はインスタンス毎の保存先(useRef)が必要。
			// 式ボディの関数には文を注入できないため対象外にする
			const withInstance =
				trackEffect &&
				info.effects.length > 0 &&
				t.isBlockStatement(info.fnPath.node.body);

			let wrappedInComponent = false;

			// setterのリネームより先にeffectを処理する。逆順にすると
			// 収集済みreferencePathsが宣言リネーム後の古い情報になる
			for (const effectPath of trackEffect ? info.effects : []) {
				const result = wrapUseEffectCallback(effectPath, info, withInstance);
				if (result.wrapped) {
					hasEffectWrapping = true;
					wrappedInComponent = true;
				}
				if (result.captured) {
					hasDepsCapture = true;
				}
			}

			if (withInstance && wrappedInComponent) {
				injectInstanceRef(info.fnPath);
				hasInstanceRef = true;
			}

			for (const setter of info.setters) {
				wrapUseStateSetter(setter, info.name);
				hasSetterWrapping = true;
			}
		}

		if (!hasSetterWrapping && !hasEffectWrapping) {
			return null;
		}

		addRuntimeImports(ast, {
			hasSetterWrapping,
			hasEffectWrapping,
			hasDepsCapture,
			hasInstanceRef,
		});

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

const moduleTag = (id: string): string => {
	let hash = 5381;
	for (let i = 0; i < id.length; i++) {
		hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
	}
	return `m${(hash >>> 0).toString(36).slice(0, 4)}`;
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

const collectComponents = (
	ast: t.File,
	tag: string,
): Map<t.Node, ComponentInfo> => {
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
					tag,
					fnPath: fnParent,
					setters: [],
					effects: [],
				};
				components.set(fnParent.node, info);
			}

			if (isUseState) {
				const setter = extractSetterInfo(path, info);
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
	info: ComponentInfo,
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

	const stateElement = pattern.elements[0];
	const line = callPath.node.loc?.start.line ?? 0;

	return {
		name: setterElement.name,
		line,
		stateId: `State_${info.name}_Line${line}_${info.tag}`,
		declarationPath: declaration,
		setterElement,
		stateElement: t.isIdentifier(stateElement) ? stateElement : null,
		referencePaths: [...binding.referencePaths],
	};
};

/**
 * 変換前:
 *   useEffect(() => {
 *     setCount(1);
 *   }, [count]);
 *
 * 変換後（_m…はモジュールパス由来のタグ）:
 *   useEffect(__wrapEffect("Effect_App_Line5_m3x2k", () => {
 *     const __butterfly_effectId = "Effect_App_Line5_m3x2k";
 *     const __bound_setCount = __v => setCount(__v, __butterfly_effectId);
 *     __bound_setCount(1);
 *   }, __butterfly_inst), __captureDeps(__butterfly_inst, "Effect_App_Line5_m3x2k",
 *     ["count"], ["State_App_Line4_m3x2k"], [count]));
 *
 * setterを使わないeffectを対象外にしないのは、effect外で定義された
 * コールバック経由のsetState呼び出しをランタイムのcurrentEffectId
 * フォールバックで帰属させるため
 */
const wrapUseEffectCallback = (
	callPath: NodePath<t.CallExpression>,
	info: ComponentInfo,
	withInstance: boolean,
): { wrapped: boolean; captured: boolean } => {
	const callback = callPath.node.arguments[0];

	if (
		!t.isArrowFunctionExpression(callback) &&
		!t.isFunctionExpression(callback)
	) {
		return { wrapped: false, captured: false };
	}

	const [callbackPath] = callPath.get("arguments");
	const line = callPath.node.loc?.start.line ?? 0;
	const effectId = `${EFFECT_ID_PREFIX}${info.name}_Line${line}_${info.tag}`;

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

	const captured = withInstance && wrapDepsArgument(callPath, info, effectId);

	const wrapArgs: t.Expression[] = [t.stringLiteral(effectId), callback];
	if (withInstance) {
		wrapArgs.push(t.identifier(INSTANCE_NAME));
	}
	callPath.node.arguments[0] = t.callExpression(
		t.identifier("__wrapEffect"),
		wrapArgs,
	);

	return { wrapped: true, captured };
};

/**
 * deps引数を__captureDepsのパススルーで包む。
 * 元のdeps式をそのまま第5引数に渡して返させるため、Reactが比較する
 * 配列インスタンスは変換前と変わらない。
 * deps省略時は毎レンダー実行でdiffに意味がないため包まない
 */
const wrapDepsArgument = (
	callPath: NodePath<t.CallExpression>,
	info: ComponentInfo,
	effectId: string,
): boolean => {
	const depsArg = callPath.node.arguments[1];
	if (
		!depsArg ||
		t.isSpreadElement(depsArg) ||
		t.isArgumentPlaceholder(depsArg)
	)
		return false;

	let namesNode: t.Expression = t.nullLiteral();
	let stateIdsNode: t.Expression = t.nullLiteral();

	if (t.isArrayExpression(depsArg)) {
		const depPaths = (
			callPath.get("arguments.1") as NodePath<t.ArrayExpression>
		).get("elements");

		const names: t.Expression[] = [];
		const stateIds: t.Expression[] = [];
		for (const depPath of depPaths) {
			const depNode = depPath.node;
			if (!depNode) {
				names.push(t.nullLiteral());
				stateIds.push(t.nullLiteral());
				continue;
			}
			names.push(t.stringLiteral(generate(depNode).code));
			const stateId = resolveDepStateId(depPath as NodePath, info);
			stateIds.push(stateId ? t.stringLiteral(stateId) : t.nullLiteral());
		}
		namesNode = t.arrayExpression(names);
		stateIdsNode = t.arrayExpression(stateIds);
	}

	callPath.node.arguments[1] = t.callExpression(t.identifier("__captureDeps"), [
		t.identifier(INSTANCE_NAME),
		t.stringLiteral(effectId),
		namesNode,
		stateIdsNode,
		depsArg,
	]);

	return true;
};

/**
 * dep識別子がこのコンポーネントのuseState由来のstate変数なら
 * そのstateIdを返す（スコープバインディングで照合）
 */
const resolveDepStateId = (
	depPath: NodePath,
	info: ComponentInfo,
): string | null => {
	if (!depPath.isIdentifier()) return null;

	const binding = depPath.scope.getBinding(depPath.node.name);
	if (!binding) return null;

	for (const setter of info.setters) {
		if (setter.stateElement && binding.identifier === setter.stateElement) {
			return setter.stateId;
		}
	}
	return null;
};

/**
 * コンポーネント先頭にインスタンス識別用のrefを注入する。
 * effectIdはコード位置由来で同一コンポーネントの複数インスタンス間で
 * 衝突するため、deps記録の保存先はレンダーごとに安定なuseRefに持たせる。
 * 生配列のunshiftではなくunshiftContainerを使うのは、後続の
 * insertAfter系がパスの位置情報を参照しており、素の配列操作だと
 * 挿入位置がずれるため
 */
const injectInstanceRef = (fnPath: NodePath<t.Function>) => {
	const declaration = t.variableDeclaration("const", [
		t.variableDeclarator(
			t.identifier(INSTANCE_NAME),
			t.memberExpression(
				t.callExpression(t.identifier(USE_REF_ALIAS), [t.objectExpression([])]),
				t.identifier("current"),
			),
		),
	]);
	(fnPath.get("body") as NodePath<t.BlockStatement>).unshiftContainer(
		"body",
		declaration,
	);
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
 *   const setCount = __wrapSetter(__butterfly_original_setCount, "App", 11,
 *     "State_App_Line11_m3x2k");
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
				t.stringLiteral(setter.stateId),
			]),
		),
	]);

	setter.declarationPath.insertAfter(wrappedSetter);
};

const addRuntimeImports = (
	ast: t.File,
	flags: {
		hasSetterWrapping: boolean;
		hasEffectWrapping: boolean;
		hasDepsCapture: boolean;
		hasInstanceRef: boolean;
	},
) => {
	const imports: t.ImportSpecifier[] = [];

	if (flags.hasSetterWrapping) {
		imports.push(
			t.importSpecifier(
				t.identifier("__wrapSetter"),
				t.identifier("__wrapSetter"),
			),
		);
	}

	if (flags.hasEffectWrapping) {
		imports.push(
			t.importSpecifier(
				t.identifier("__wrapEffect"),
				t.identifier("__wrapEffect"),
			),
		);
	}

	if (flags.hasDepsCapture) {
		imports.push(
			t.importSpecifier(
				t.identifier("__captureDeps"),
				t.identifier("__captureDeps"),
			),
		);
	}

	if (imports.length === 0) return;

	ast.program.body.unshift(
		t.importDeclaration(imports, t.stringLiteral(RUNTIME_MODULE)),
	);

	// インスタンスrefはReactのuseRefで作る。既存importとの衝突を避ける
	// ため常にエイリアスで追加する（同一モジュールへの複数import宣言は合法）
	if (flags.hasInstanceRef) {
		ast.program.body.unshift(
			t.importDeclaration(
				[
					t.importSpecifier(
						t.identifier(USE_REF_ALIAS),
						t.identifier("useRef"),
					),
				],
				t.stringLiteral("react"),
			),
		);
	}
};
