# 🦋 vite-plugin-butterfly-effect

[![CI](https://github.com/yuuki-katsuta/butterfly-effect/actions/workflows/ci.yml/badge.svg)](https://github.com/yuuki-katsuta/butterfly-effect/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/vite-plugin-butterfly-effect.svg)](https://www.npmjs.com/package/vite-plugin-butterfly-effect)
[![license](https://img.shields.io/npm/l/vite-plugin-butterfly-effect.svg)](./LICENSE)

A Vite plugin that visualizes React `useEffect` → `setState` chains as butterflies fluttering over your app, in real time.

> A butterfly flaps its wings, and a storm breaks somewhere far away.
> In React, that wing-flap is a `setState` inside a `useEffect` — the classic
> source of surprising re-renders, cascading effects, and infinite loops.
> The more butterflies you see, the more chaos is brewing.

https://github.com/user-attachments/assets/1a563ffe-b9af-4d5a-8bb0-303cd58dd037

## What it does

- **Tracks `setState` calls made inside `useEffect`** — and only those. State updates from event handlers stay silent.
- **Survives `await`**: updates after asynchronous work inside an effect are still attributed to the effect that started them (closure-bound effect IDs, no stack-trace guessing).
- **Follows indirect calls**: setters invoked through `useCallback`/`useMemo`-cached callbacks or helper functions are attributed to the running effect.
- **Renders each tracked update as a butterfly** on a click-through canvas overlay, with an optional status panel showing live counts.

Unlike lint rules (`react-hooks/set-state-in-effect`), this happens at runtime: it sees asynchronous writes, chained effects, and how *often* they fire — not just where they are written.

## Install

```bash
npm install -D vite-plugin-butterfly-effect
```

## Quick start

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import butterflyEffect from "vite-plugin-butterfly-effect";

export default defineConfig({
  plugins: [react(), butterflyEffect({ showStatus: true })],
});
```

Run `vite` and interact with your app. Butterflies appear whenever an effect writes state. The plugin only runs on the dev server (`apply: "serve"`); production builds are never instrumented.

## Options

| Option           | Type      | Default     | Description                                                        |
| ---------------- | --------- | ----------- | ------------------------------------------------------------------ |
| `enabled`        | `boolean` | `true`      | Disable the plugin entirely (it is already dev-server-only).       |
| `showStatus`     | `boolean` | `false`     | Show the status panel (update count / active butterflies).         |
| `maxButterflies` | `number`  | `10`        | Maximum butterflies on screen at once.                             |
| `animationSpeed` | `number`  | `1000`      | Lifetime of each butterfly in milliseconds.                        |
| `trackState`     | `boolean` | `true`      | Master switch for the code transform.                              |
| `trackEffect`    | `boolean` | `true`      | Wrap `useEffect` callbacks (attribution requires this).            |
| `theme`          | `string`  | `"default"` | Reserved for future themes.                                        |

## How it works

1. A Babel transform rewrites `const [x, setX] = useState()` so the setter is wrapped with a tracking function, and wraps every `useEffect` callback with an effect-ID context. Setter references *inside* an effect are resolved through scope bindings (not name matching), so member expressions, shadowed locals, and same-named setters in other components are never touched.
2. At runtime, a state update is attributed to an effect if it carries a closure-bound effect ID (async-safe) or happens during an effect's synchronous execution (covers cached callbacks). Anything else — event handlers, external stores — emits nothing.
3. The overlay subscribes to these events and draws butterflies.

## Caveats

- **React `<StrictMode>`** runs one extra setup+cleanup cycle per effect in development, so initial-mount butterflies appear twice. That is React re-running your effects, faithfully reported.
- **React Compiler**: when `babel-plugin-react-compiler` runs first, effect callbacks may become memoized references that the transform cannot wrap; tracking degrades silently.
- Aliased hook imports (`import { useState as useS }`) are not instrumented.
- `useReducer` is not tracked yet (see roadmap).

## Roadmap

- [ ] Root-cause view: which dependency change fired the effect
- [ ] Recording with a timeline report of effect/state activity
- [ ] Causal graph (DAG) of effect → state → effect chains
- [ ] Storm detection: warn when update cycles run hot
- [ ] `useReducer` support

## License

[MIT](./LICENSE)
