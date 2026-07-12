import { afterEach, describe, expect, test, vi } from "vitest";
import {
	__captureDeps,
	__wrapEffect,
	__wrapSetter,
	ButterflyEvents,
} from "../runtime";
import { transformReactCode } from "../transform";
import type { ButterflyEvent } from "../types";

const transform = (
	code: string,
	options: { trackState?: boolean; trackEffect?: boolean } = {},
) => {
	return transformReactCode(code, "/test/component.tsx", {
		trackState: options.trackState ?? true,
		trackEffect: options.trackEffect ?? true,
	});
};

describe("Closure Binding方式のコード変換", () => {
	test("useEffect内のsetState呼び出しを変換する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(count + 1);
  }, [count]);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain('"App"');
	});

	test("アロー関数コンポーネントを処理する", () => {
		const code = `
import { useEffect, useState } from "react";

const MyComponent = () => {
  const [value, setValue] = useState(0);

  useEffect(() => {
    setValue(10);
  }, []);

  return <div>{value}</div>;
};
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain('"MyComponent"');
	});

	test("複数のuseStateフックを処理する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState("");

  useEffect(() => {
    setCount(1);
    setName("test");
  }, []);

  return <div>{count} {name}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		// 各setStateラッパーに対して2つのトラッキング呼び出しがあるべき
		const trackingCalls = result?.code.match(/__wrapSetter/g);
		expect(trackingCalls?.length).toBeGreaterThanOrEqual(2);
	});

	test("インラインスタイル付きJSX（JSX内の波括弧）を処理する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(count + 1);
  }, [count]);

  return <div style={{ margin: 0, padding: 10 }}>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain('"App"');
	});

	test("useEffect外のuseCallback内のsetState呼び出しも変換する", () => {
		const code = `
import { useCallback, useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  const handleClick = useCallback(() => {
    setCount(count + 1);
  }, [count]);

  useEffect(() => {
    //
  }, []);

  return <button onClick={handleClick}>{count}</button>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("trackStateがfalseの場合はnullを返す", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(count + 1);
  }, [count]);

  return <div>{count}</div>;
}
`;

		const result = transform(code, { trackState: false });

		expect(result).toBeNull();
	});

	test("useStateもuseEffectもない場合はnullを返す", () => {
		const code = `
function App() {
  return <div>Hello</div>;
}
`;

		const result = transform(code);

		expect(result).toBeNull();
	});

	test("複数行のuseState分割代入を処理する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [
    count,
    setCount
  ] = useState(0);

  useEffect(() => {
    setCount(1);
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("TypeScriptのジェネリック型を処理する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    setCount(1);
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("useCallback内のsetState呼び出しを変換する", () => {
		const code = `
import { useCallback, useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);
  const [b, setB] = useState(0);

  const setCountBFn = useCallback(() => {
    setB(count + 1);
  }, [count]);

  useEffect(() => {
    setCountBFn();
  }, [setCountBFn]);

  return <div>{b}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toMatch(/setB.*count.*1/);
	});

	test("useEffectから呼ばれるuseCallback内のsetState呼び出しを変換する", () => {
		const code = `
import { useCallback, useEffect, useState } from "react";

function App() {
  const [data, setData] = useState([]);

  const fetchData = useCallback(() => {
    fetch('/api/data').then(res => {
      setData(res.json());
    });
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return <div>{data.length}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("setData");
	});

	test("useEffectから呼ばれる通常関数内のsetStateを追跡する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);
  const [b, setB] = useState(0);

  const setCountBFn = () => {
    setB(count + 1);
  };

  useEffect(() => {
    setCountBFn();
  }, []);

  return <div>{b}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("ネストした関数呼び出し（2階層）内のsetStateを追跡する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);
  const [b, setB] = useState(0);

  const setCountAFn = () => {
    setB(count + 1);
  };

  const setCountBFn = () => {
    setCountAFn();
  };

  useEffect(() => {
    setCountBFn();
  }, []);

  return <div>{b}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("ネストしたuseCallback呼び出し内のsetStateを追跡する", () => {
		const code = `
import { useCallback, useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);
  const [b, setB] = useState(0);

  const setCountAFn = useCallback(() => {
    setB(count + 1);
  }, [count]);

  const setCountBFn = useCallback(() => {
    setCountAFn();
  }, [count]);

  useEffect(() => {
    setCountBFn();
  }, [setCountBFn]);

  return <div>{b}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("深くネストした関数呼び出し（3階層以上）内のsetStateを追跡する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [value, setValue] = useState(0);

  const level3 = () => setValue(100);
  const level2 = () => level3();
  const level1 = () => level2();

  useEffect(() => {
    level1();
  }, []);

  return <div>{value}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("混合関数タイプ（通常関数+useCallback）内のsetStateを追跡する", () => {
		const code = `
import { useCallback, useEffect, useState } from "react";

function App() {
  const [value, setValue] = useState(0);

  const regularFn = () => setValue(50);

  const callbackFn = useCallback(() => {
    regularFn();
  }, []);

  useEffect(() => {
    callbackFn();
  }, [callbackFn]);

  return <div>{value}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("setStateを使用しないuseEffectは変換しない", () => {
		const code = `
import { useEffect, useState } from "react";
import { externalFunction } from "./utils";

function App() {
  const [value, setValue] = useState(0);

  useEffect(() => {
    externalFunction();
  }, []);

  return <div>{value}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("__butterfly_original_setValue");
		expect(result?.code).not.toContain("__bound_setValue");
	});

	test("条件付きで呼ばれるネスト関数内のsetStateを追跡する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [value, setValue] = useState(0);

  const updateValue = () => {
    if (true) {
      setValue(100);
    }
  };

  useEffect(() => {
    updateValue();
  }, []);

  return <div>{value}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("カスタムフック内のuseCallback内のsetStateを追跡する（クロスコンポーネントエフェクトチェーン用）", () => {
		const code = `
import { useCallback, useState } from "react";

export const useSample = () => {
  const [, setCountA] = useState(0);

  const increment = useCallback(() => {
    setCountA((prev) => prev + 1);
  }, []);

  return { increment };
};
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("カスタムフック内の通常関数内のsetStateを追跡する（useCallbackなしでも）", () => {
		const code = `
import { useState } from "react";

export const useSample = () => {
  const [, setCountA] = useState(0);

  const increment = () => {
    setCountA((prev) => prev + 1);
  };

  return { increment };
};
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("setCountA");
	});

	test("複数の経路で到達するsetStateのトラッキングは1回だけ注入する", () => {
		const code = `
import { useCallback, useEffect, useState } from "react";

const useSampleState = () => {
  const [countA, setCountA] = useState(0);
  const increment = useCallback(() => {
    setCountA((prev) => prev + 1);
  }, []);
  return { countA, setCountA, increment };
};

export const useExecFn = () => {
  const { countA, setCountA, increment } = useSampleState();
  const exec = useCallback(() => {
    increment();
  }, [increment]);

  useEffect(() => {
    exec();
  }, [exec]);

  return { exec, countA };
};
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");

		// __wrapSetterの注入回数をカウント
		const trackingCalls = result?.code.match(/__wrapSetter/g);
		expect(trackingCalls?.length).toBeLessThanOrEqual(2);
	});

	test("ローカル関数に引数として渡されたコールバック内のsetStateを追跡する", () => {
		const code = `
import { useCallback, useEffect, useState } from "react";

function App() {
  const [b, setB] = useState(0);

  const setCountBFn = useCallback(() => {
    setB((prev) => prev + 1);
  }, []);

  const exec = (fn: () => void) => {
    fn();
  };

  useEffect(() => {
    exec(setCountBFn);
  }, []);

  return <div>{b}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("setB");
	});

	test("インポートされた関数に渡されたコールバック内のsetStateを追跡する（クロスファイル）", () => {
		const code = `
import { useCallback, useEffect, useState } from "react";
import { useExecFn } from "./libs/useExecFn";

function App() {
  const [count, setCount] = useState(0);
  const [b, setB] = useState(0);

  const setCountBFn = useCallback(() => {
    setB(count + 1);
  }, [count]);

  const { exec } = useExecFn();

  useEffect(() => {
    exec(setCountBFn);
  }, [exec, setCountBFn]);

  return <div>b: {b}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("setB");
	});

	test("複数のコールバックが引数として渡された場合のsetStateを追跡する", () => {
		const code = `
import { useCallback, useEffect, useState } from "react";

function App() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);

  const callbackA = useCallback(() => {
    setA(1);
  }, []);

  const callbackB = useCallback(() => {
    setB(2);
  }, []);

  const execMultiple = (fn1: () => void, fn2: () => void) => {
    fn1();
    fn2();
  };

  useEffect(() => {
    execMultiple(callbackA, callbackB);
  }, []);

  return <div>{a} {b}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		// setAとsetBの両方を追跡
		const trackingCalls = result?.code.match(/__wrapSetter/g);
		expect(trackingCalls?.length).toBeGreaterThanOrEqual(2);
	});

	test("カスタムフックコールバック内のsetStateを追跡する（useSampleパターンのシミュレーション）", () => {
		const code = `
import { useCallback, useState } from "react";

export const useSample = () => {
  const [countA, setCountA] = useState(0);

  const increment = useCallback(() => {
    setCountA((prev) => prev + 1);
  }, []);

  return { increment, countA };
};
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("__butterfly_original_setCountA");
		expect(result?.code).toMatch(
			/const setCountA = __wrapSetter\(__butterfly_original_setCountA/,
		);
	});

	test("useEffect内でClosure Bindingによりバインドされたsetterを作成する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(count + 1);
  }, [count]);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__butterfly_effectId");
		expect(result?.code).toContain("__bound_setCount");
		expect(result?.code).toMatch(
			/__bound_setCount.*=.*__v.*=>.*setCount\(__v, __butterfly_effectId\)/,
		);
	});

	test("useEffect内で複数のバインドされたsetterを作成する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);

  useEffect(() => {
    setA(1);
    setB(2);
  }, []);

  return <div>{a} {b}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__bound_setA");
		expect(result?.code).toContain("__bound_setB");
	});

	test("オブジェクトプロパティアクセスパターンを処理する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const callbacks = { update: setCount };
    callbacks.update(1);
  }, []);

  return <button onClick={() => setCount(count + 1)}>Click</button>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("__butterfly_original_setCount");
		expect(result?.code).toContain("__bound_setCount");
	});

	test("変数エイリアスパターンを処理する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fn = setCount;
    fn(1);
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("__butterfly_original_setCount");
		expect(result?.code).toContain("__bound_setCount");
	});

	test("配列アクセスパターンを処理する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const setters = [setCount];
    setters[0](1);
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("__butterfly_original_setCount");
		expect(result?.code).toContain("__bound_setCount");
	});

	test("useEffectから呼ばれた時のみsetStateを追跡する（ランタイム動作）", () => {
		const code = `
import { useCallback, useState } from "react";

export const useSample = () => {
  const [count, setCount] = useState(0);

  const increment = useCallback(() => {
    setCount((prev) => prev + 1);
  }, []);

  return { increment };
};
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("setCount");
	});

	test("useEffectから呼ばれる非同期関数内のsetStateを追跡する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [countA, setCountA] = useState(0);

  useEffect(() => {
    async function fetch() {
      const sleep = () => new Promise((resolve) => setTimeout(resolve, 1000));
      await sleep();
      setCountA(1);
    }
    fetch();
  }, []);

  return <div>{countA}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		// setterをラップ
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("__butterfly_original_setCountA");
		// Closure Bindingで、バインドされたsetterがクロージャでeffectIdをキャプチャする
		expect(result?.code).toContain("__butterfly_effectId");
		expect(result?.code).toContain("__bound_setCountA");
		expect(result?.code).toMatch(
			/async function fetch.*await.*__bound_setCountA/s,
		);
	});

	test("useEffect内で直接awaitを使用したsetStateを追跡する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const response = await fetch('/api/data');
      const json = await response.json();
      setData(json);
    })();
  }, []);

  return <div>{data}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("__butterfly_effectId");
		expect(result?.code).toContain("__bound_setData");
		expect(result?.code).toMatch(/async.*await.*__bound_setData/s);
	});

	test("useEffect内のPromise.thenチェーン内のsetStateを追跡する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [value, setValue] = useState(0);

  useEffect(() => {
    Promise.resolve(42)
      .then(result => {
        setValue(result);
      });
  }, []);

  return <div>{value}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).toContain("__butterfly_effectId");
		expect(result?.code).toContain("__bound_setValue");
	});

	test("useEffect内のsetTimeoutをClosure Bindingで処理する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setTimeout(() => {
      setCount(1);
    }, 1000);
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__butterfly_effectId");
		expect(result?.code).toContain("__bound_setCount");
		expect(result?.code).toMatch(/setTimeout.*__bound_setCount/s);
	});

	test("ネストした非同期関数をClosure Bindingで処理する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    async function outer() {
      async function inner() {
        await Promise.resolve();
        setCount(1);
      }
      await inner();
    }
    outer();
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__butterfly_effectId");
		expect(result?.code).toContain("__bound_setCount");
	});
});

describe("スコープ解決の回帰テスト", () => {
	test("effect内のメンバー式プロパティ（obj.setCount）はリネームしない", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    api.setCount(5);
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("api.setCount(5)");
		expect(result?.code).not.toContain("api.__bound_setCount");
	});

	test("effect内でシャドーイングされたローカル変数はリネームしない", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const setCount = (n) => log(n);
    setCount(1);
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		// ローカルバインディングへの参照はsetter扱いしない
		expect(result?.code).not.toContain("__bound_setCount");
	});

	test("ネストブロック内のシャドーイングと外側setter使用が混在しても正しく区別する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(1);
    if (flag) {
      const setCount = localFn;
      setCount(2);
    }
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		// 外側setterへの参照だけがバインド版になる
		expect(result?.code).toMatch(/__bound_setCount\(1\)/);
		expect(result?.code).not.toMatch(/__bound_setCount\(2\)/);
		expect(result?.code).toMatch(/setCount\(2\)/);
	});

	test("1ファイル複数コンポーネントでそれぞれのコンポーネント名に帰属する", () => {
		const code = `
import { useEffect, useState } from "react";

function Foo() {
  const [a, setA] = useState(0);
  useEffect(() => { setA(1); }, []);
  return <div>{a}</div>;
}

function Bar() {
  const [b, setB] = useState(0);
  useEffect(() => { setB(2); }, []);
  return <div>{b}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toMatch(
			/__wrapSetter\(__butterfly_original_setA, "Foo"/,
		);
		expect(result?.code).toMatch(
			/__wrapSetter\(__butterfly_original_setB, "Bar"/,
		);
		expect(result?.code).toContain("Effect_Foo_Line");
		expect(result?.code).toContain("Effect_Bar_Line");
	});

	test("別コンポーネントの同名setterをバインドしない", () => {
		const code = `
import { useEffect, useState } from "react";

function Foo() {
  const [v, setV] = useState(0);
  return <div>{v}</div>;
}

function Bar() {
  useEffect(() => { setV(2); }, []);
  return <div />;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).not.toContain("__bound_setV");
	});

	test("変換済みコードを再変換しない（冪等性）", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);
  useEffect(() => { setCount(1); }, []);
  return <div>{count}</div>;
}
`;

		const first = transform(code);
		expect(first).not.toBeNull();

		const second = transform(first?.code ?? "");
		expect(second).toBeNull();
	});

	test("ランタイムを正規にimportするユーザーファイルは変換対象のまま", () => {
		const code = `
import { useEffect, useState } from "react";
import { ButterflyEvents } from "vite-plugin-butterfly-effect/runtime";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const off = ButterflyEvents.on(() => {});
    setCount(1);
    return off;
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		// ButterflyEvents購読のimportは変換済みマーカーではない
		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
	});

	test("trackEffect: false の場合はeffectをラップせず、setterのみラップする", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(1);
  }, []);

  return <div>{count}</div>;
}
`;

		const result = transform(code, { trackEffect: false });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__wrapSetter");
		expect(result?.code).not.toContain("__wrapEffect");
		expect(result?.code).not.toContain("__bound_setCount");
	});

	test("ソースマップを返す", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);
  useEffect(() => { setCount(1); }, []);
  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.map).not.toBeNull();
		expect(result?.map).toBeDefined();
	});
});

describe("deps記録（発火原因の特定）の変換", () => {
	test("deps配列を__captureDepsで包み、dep名とstateIdを静的に埋め込む", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(count + 1);
  }, [count]);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toContain(
			"const __butterfly_inst = __butterfly_useRef({}).current",
		);
		expect(result?.code).toContain(
			'import { useRef as __butterfly_useRef } from "react"',
		);
		expect(result?.code).toMatch(
			/__captureDeps\(__butterfly_inst, "Effect_App_Line\d+_m[0-9a-z]+", \["count"\], \["State_App_Line\d+_m[0-9a-z]+"\], \[count\]\)/,
		);
		expect(result?.code).toMatch(
			/__wrapEffect\("Effect_App_Line\d+_m[0-9a-z]+", .*__butterfly_inst\)/s,
		);
	});

	test("state以外のdepはstateId=nullで名前だけ記録する", () => {
		const code = `
import { useEffect, useState } from "react";

function App({ user }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(1);
  }, [user.id, count]);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toMatch(
			/\["user\.id", "count"\], \[null, "State_App_Line\d+_m[0-9a-z]+"\]/,
		);
	});

	test("deps省略時は__captureDepsで包まない", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(1);
  });

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).not.toContain("__captureDeps");
	});

	test("配列リテラルでないdepsは名前なし（値のみ）で記録する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);
  const deps = [count];

  useEffect(() => {
    setCount(1);
  }, deps);

  return <div>{count}</div>;
}
`;

		const result = transform(code);

		expect(result).not.toBeNull();
		expect(result?.code).toMatch(
			/__captureDeps\(__butterfly_inst, "Effect_App_Line\d+_m[0-9a-z]+", null, null, deps\)/,
		);
	});

	test("trackEffect: false ならdeps記録もインスタンスrefも注入しない", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(1);
  }, [count]);

  return <div>{count}</div>;
}
`;

		const result = transform(code, { trackEffect: false });

		expect(result).not.toBeNull();
		expect(result?.code).not.toContain("__captureDeps");
		expect(result?.code).not.toContain("__butterfly_inst");
		expect(result?.code).not.toContain("__butterfly_useRef");
	});
});

describe("変換出力の実行時動作（transform + runtime 統合）", () => {
	afterEach(() => {
		ButterflyEvents.clear();
	});

	/**
	 * 変換後コードを実際に実行するヘルパー。
	 * JSXを含まないコンポーネント（return null）を前提に、
	 * React代替のuseState/useEffectスタブと実ランタイムを注入する
	 */
	const evalComponent = (
		code: string,
		extraGlobals: Record<string, unknown> = {},
		hooks: { useState?: (initial: unknown) => unknown[] } = {},
	) => {
		const result = transform(code);
		expect(result).not.toBeNull();

		const body = (result?.code ?? "").replace(/^import .*$/gm, "");
		const effectQueue: Array<() => unknown> = [];
		const useState =
			hooks.useState ?? ((initial: unknown) => [initial, () => {}]);
		const useEffect = (cb: () => unknown) => {
			effectQueue.push(cb);
		};
		const refs: { current: unknown }[] = [];
		let refIndex = 0;
		const useRef = (initial: unknown) => {
			// レンダー毎に同じrefを返す（Reactのフック順序前提を模倣）
			const ref = refs[refIndex] ?? { current: initial };
			refs[refIndex] = ref;
			refIndex++;
			return ref;
		};

		const events: ButterflyEvent[] = [];
		ButterflyEvents.on((e) => events.push(e));

		const globalNames = Object.keys(extraGlobals);
		const factory = new Function(
			"__wrapSetter",
			"__wrapEffect",
			"__captureDeps",
			"__butterfly_useRef",
			"useState",
			"useEffect",
			...globalNames,
			`${body}\nreturn App;`,
		);
		const App = factory(
			__wrapSetter,
			__wrapEffect,
			__captureDeps,
			useRef,
			useState,
			useEffect,
			...globalNames.map((n) => extraGlobals[n]),
		);

		return {
			render: () => {
				refIndex = 0;
				return App();
			},
			runEffects: () => {
				const pending = [...effectQueue];
				effectQueue.length = 0;
				for (const cb of pending) cb();
			},
			stateEvents: () => events.filter((e) => e.kind === "state-update"),
			effectRuns: () => events.filter((e) => e.kind === "effect-run"),
			events,
		};
	};

	test("effect内のsetStateはeffectId付きイベントを発火する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(1);
  }, []);

  return null;
}
`;

		const { render, runEffects, stateEvents } = evalComponent(code);
		render();
		runEffects();

		const updates = stateEvents();
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			kind: "state-update",
			componentName: "App",
		});
		expect(updates[0].effectId).toMatch(/^Effect_App_Line\d+_m[0-9a-z]+$/);
	});

	test("effect内のobj.setCount()呼び出しはクラッシュせず元のメソッドを呼ぶ", () => {
		const apiSetCount = vi.fn();
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    api.setCount(5);
  }, []);

  return null;
}
`;

		const { render, runEffects, stateEvents } = evalComponent(code, {
			api: { setCount: apiSetCount },
		});
		render();

		expect(() => runEffects()).not.toThrow();
		expect(apiSetCount).toHaveBeenCalledWith(5);
		expect(stateEvents()).toHaveLength(0);
	});

	test("effect内のシャドーイングされたローカル関数は引数を漏らさず呼ばれ、state setterは呼ばれない", () => {
		const calls: unknown[][] = [];
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const setCount = (n) => record(n);
    setCount(1);
  }, []);

  return null;
}
`;

		const { render, runEffects, stateEvents } = evalComponent(code, {
			record: (...args: unknown[]) => calls.push(args),
		});
		render();
		runEffects();

		// ローカル関数が余分な引数なしで呼ばれる（挙動改変なし）
		expect(calls).toEqual([[1]]);
		// state setterには帰属しない
		expect(stateEvents()).toHaveLength(0);
	});

	test("イベントハンドラ相当のeffect外呼び出しではイベントを発火しない", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    //
  }, []);

  return () => setCount(count + 1);
}
`;

		const { render, runEffects, stateEvents } = evalComponent(code);
		const handler = render() as () => void;
		runEffects();
		handler();

		expect(stateEvents()).toHaveLength(0);
	});

	test("effect連鎖の因果と深度を2回のレンダー越しに追跡する", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);

  useEffect(() => {
    setA(1);
  }, []);

  useEffect(() => {
    setB(a + 1);
  }, [a]);

  return null;
}
`;

		// Reactの代わりにstate値の変化を手動で与える
		const stateValues = [0, 0];
		let stateIndex = 0;
		const useState = (initial: unknown) => {
			const value = stateValues[stateIndex] ?? initial;
			stateIndex++;
			return [value, () => {}];
		};

		const { render, runEffects, effectRuns, stateEvents } = evalComponent(
			code,
			{},
			{ useState },
		);

		// render#1: マウント。E1がaをdepth0で書く
		stateIndex = 0;
		render();
		runEffects();

		// render#2: aが1に変わった世界
		stateValues[0] = 1;
		stateIndex = 0;
		render();
		runEffects();

		const runs = effectRuns();
		const e2Runs = runs.filter((r) => r.changedDeps?.length);
		expect(e2Runs).toHaveLength(1);
		expect(e2Runs[0]).toMatchObject({
			depth: 1,
			causeStateId: expect.stringMatching(/^State_App_Line\d+_m[0-9a-z]+$/),
			causeEffectId: expect.stringMatching(/^Effect_App_Line\d+_m[0-9a-z]+$/),
		});
		expect(e2Runs[0].changedDeps?.[0]).toMatchObject({
			name: "a",
			prevPreview: "0",
			nextPreview: "1",
		});

		// E2内のsetBはdepth1のstate-updateになる
		const bUpdates = stateEvents().filter((e) => e.depth === 1);
		expect(bUpdates.length).toBeGreaterThanOrEqual(1);
	});
});
