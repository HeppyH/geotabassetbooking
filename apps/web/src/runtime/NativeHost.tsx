/*───────────────────── Native Host (production entry) ─────────────────────
 * Subscribes to the MyGeotab lifecycle bridge and composes the native runtime through
 * createNativeRuntime(). It renders the App with a runtime object and nothing else.
 *
 * This file must not import the offline simulation (data/dataProvider, data/mockMyGeotab,
 * simulation/*). Enforced by test/runtimeArchitecture.test.mjs.
 */
import { useEffect, useMemo, useState } from "react";
import App from "../ui/App";
import { getLifecycleApi, subscribeToLifecycle } from "../config/lifecycleBridge";
import type { AppRuntime } from "./appRuntime";
import { createInitialNativeRuntime, createNativeRuntime } from "./nativeRuntime";

export function NativeHost() {
  const [runtime, setRuntime] = useState<AppRuntime>(() => createInitialNativeRuntime());

  useEffect(() => {
    let mounted = true;
    let seq = 0;
    let currentApi: unknown = undefined;

    const compose = (api: ReturnType<typeof getLifecycleApi>["api"]) => {
      const mySeq = ++seq;
      if (!api) {
        setRuntime(createInitialNativeRuntime());
        return;
      }
      void createNativeRuntime({ api }).then((next) => {
        if (mounted && seq === mySeq) setRuntime(next);
      });
    };

    const unsubscribe = subscribeToLifecycle((bridge) => {
      if (!mounted) return;
      if (bridge.api !== currentApi) {
        currentApi = bridge.api;
        compose(bridge.api);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const stable = useMemo(() => runtime, [runtime]);
  return <App runtime={stable} />;
}
