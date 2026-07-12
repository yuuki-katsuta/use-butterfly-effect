/**
 * transform（コード生成側）とruntime（検証側）で共有する契約
 */

/** 変換コードが注入するランタイムモジュールのimport元 */
export const RUNTIME_MODULE = "vite-plugin-butterfly-effect/runtime";

/** 仮想モジュールが読み込むオーバーレイのimport元 */
export const OVERLAY_MODULE = "vite-plugin-butterfly-effect/overlay";

/** 生成されるeffectIdのプレフィクス（例: Effect_App_Line5） */
export const EFFECT_ID_PREFIX = "Effect_";
