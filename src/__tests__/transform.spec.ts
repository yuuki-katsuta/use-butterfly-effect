import { describe, expect, test } from "vitest";
import { transformReactCode } from "../transform";

const transform = (
	code: string,
	options: { trackState?: boolean; trackEffect?: boolean } = {},
) => {
	return transformReactCode(code, "/test/component.tsx", process.cwd(), {
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
		expect(result?.code).toContain("__trackStateUpdate");
		expect(result?.code).toContain('componentName: "App"');

		const trackingCalls = result?.code.match(/__trackStateUpdate\(/g);
		expect(trackingCalls).toHaveLength(1);
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
		expect(result?.code).toContain("__trackStateUpdate");
		expect(result?.code).toContain('componentName: "MyComponent"');
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
		expect(result?.code).toContain("__trackStateUpdate");
		// 各setStateラッパーに対して2つのトラッキング呼び出しがあるべき
		const trackingCalls = result?.code.match(/__trackStateUpdate/g);
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
		expect(result?.code).toContain("__trackStateUpdate");
		expect(result?.code).toContain('componentName: "App"');
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");

		// __trackStateUpdateの注入回数をカウント
		const trackingCalls = result?.code.match(/__trackStateUpdate/g);
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
		// setAとsetBの両方を追跡
		const trackingCalls = result?.code.match(/__trackStateUpdate/g);
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
		expect(result?.code).toContain("__trackStateUpdate");
		expect(result?.code).toContain("__butterfly_original_setCountA");
		expect(result?.code).toMatch(
			/const setCountA = \(__butterfly_value, __butterfly_effectId\)/,
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
		expect(result?.code).toContain("__trackStateUpdate");
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
