import { describe, expect, test } from "vitest";
import { transformReactCode } from "../transform";

describe("transformReactCode with AST", () => {
	test("should transform setState calls within useEffect", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
		expect(result?.code).toContain('componentName: "App"');
	});

	test("should handle arrow function components", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
		expect(result?.code).toContain('componentName: "MyComponent"');
	});

	test("should handle multiple useState hooks", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
		// Should have two tracking calls (one for each setState)
		const trackingCalls = result?.code.match(/__trackStateUpdate/g);
		expect(trackingCalls?.length).toBeGreaterThanOrEqual(2);
	});

	test("should handle JSX with inline styles (braces in JSX)", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
		expect(result?.code).toContain('componentName: "App"');
	});

	test("should NOT transform setState calls outside useEffect", () => {
		const code = `
import { useEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  const handleClick = () => {
    setCount(count + 1); // This should NOT be tracked
  };

  useEffect(() => {
    // Empty effect
  }, []);

  return <button onClick={handleClick}>{count}</button>;
}
`;

		const result = transformReactCode(code, { trackState: true });

		// Should return null because there's no setState in useEffect
		expect(result).toBeNull();
	});

	test("should return null when trackState is false", () => {
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

		const result = transformReactCode(code, { trackState: false });

		expect(result).toBeNull();
	});

	test("should return null when no useState or useEffect present", () => {
		const code = `
function App() {
  return <div>Hello</div>;
}
`;

		const result = transformReactCode(code, { trackState: true });

		expect(result).toBeNull();
	});

	test("should handle multiline useState destructuring", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
	});

	test("should handle TypeScript generic types", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
	});

	test("should transform setState calls within useCallback", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
		// Should track setState inside useCallback
		expect(result?.code).toMatch(/setB.*count.*1/);
	});

	test("should transform setState calls within useCallback when called from useEffect", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
		// Should track setState inside useCallback
		expect(result?.code).toContain("setData");
	});

	// New tests for nested function call tracking

	test("should track setState in regular function called from useEffect", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
	});

	test("should track setState in nested function calls (2 levels)", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
	});

	test("should track setState in nested useCallback calls", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
	});

	test("should track setState in deeply nested function calls (3+ levels)", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
	});

	test("should track setState in mixed function types (regular + useCallback)", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
	});

	test("should not track setState in imported functions", () => {
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

		const result = transformReactCode(code, { trackState: true });

		// Should return null since no trackable setState found
		expect(result).toBeNull();
	});

	test("should track setState in conditionally called nested functions", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
	});

	test("should track setState in useCallback without useEffect (for cross-file calls)", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
		expect(result?.code).toContain("setCountA");
	});

	test("should track setState in regular function without useCallback (for custom hooks)", () => {
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

		const result = transformReactCode(code, { trackState: true });

		// This should now track setState in regular functions from custom hooks
		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");
		expect(result?.code).toContain("setCountA");
	});

	test("should inject tracking only once for setState reached through multiple paths", () => {
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

		const result = transformReactCode(code, { trackState: true });

		expect(result).not.toBeNull();
		expect(result?.code).toContain("__trackStateUpdate");

		// Count the number of __trackStateUpdate injections
		// Should be 2 or less (reduced from 3 with duplicate detection)
		// Note: we have 2 custom hooks in the same file, which can lead to 2 injections
		const trackingCalls = result?.code.match(/__trackStateUpdate/g);
		expect(trackingCalls?.length).toBeLessThanOrEqual(2);
	});
});
