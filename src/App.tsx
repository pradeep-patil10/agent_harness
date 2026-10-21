import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type CallSettings } from "./agent/CallController";
import { CallScreen } from "./components/CallScreen";
import { HistoryScreen } from "./components/HistoryScreen";
import { ReviewScreen } from "./components/ReviewScreen";
import { SetupScreen, type EngineStatus } from "./components/SetupScreen";
import { detectDevice, recommendModel, type DeviceReport } from "./lib/capabilities";
import { loadPrefs, requestPersistentStorage, savePrefs } from "./lib/storage";
import type { SessionRecord } from "./lib/types";
import { findModel } from "./llm/catalog";
import { MockProvider } from "./llm/mock";
import { OpenAICompatProvider } from "./llm/openai";
import type { LLMProvider } from "./llm/provider";
import { DEFAULT_PREFS, type Prefs } from "./prefs";
import { getScenario } from "./scenarios/scenarios";

type View = { name: "setup" } | { name: "call" } | { name: "review"; record: SessionRecord } | { name: "history" };

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = loadPrefs("prefs", DEFAULT_PREFS);
    // ?demo in the URL forces the scripted buyer (handy for testing).
    return new URLSearchParams(location.search).has("demo") ? { ...p, engine: "demo" } : p;
  });
  const [device, setDevice] = useState<DeviceReport | null>(null);
  const [view, setView] = useState<View>({ name: "setup" });
  const [engine, setEngine] = useState<EngineStatus>({ phase: "none" });
  const providerRef = useRef<LLMProvider | null>(null);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs(p => {
      const next = { ...p, ...patch };
      savePrefs("prefs", next);
      return next;
    });
  }, []);

  useEffect(() => {
    detectDevice().then(d => {
      setDevice(d);
      setPrefs(p => (p.modelBase ? p : { ...p, modelBase: recommendModel(d, p.language).base }));
    });
  }, []);

  const loadEngine = useCallback(async () => {
    await providerRef.current?.dispose();
    providerRef.current = null;
    let provider: LLMProvider;
    if (prefs.engine === "demo") provider = new MockProvider(prefs.language);
    else if (prefs.engine === "cloud") provider = new OpenAICompatProvider(prefs.cloud);
    else {
      const { WebLLMProvider } = await import("./llm/webllm");
      provider = new WebLLMProvider(findModel(prefs.modelBase), device?.shaderF16 ?? true);
      void requestPersistentStorage();
    }
    setEngine({ phase: "loading", progress: 0, text: "Starting…", label: provider.label });
    try {
      await provider.load((progress, text) => setEngine({ phase: "loading", progress, text, label: provider.label }));
      providerRef.current = provider;
      setEngine({ phase: "ready", label: provider.label });
    } catch (err) {
      await provider.dispose();
      setEngine({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [prefs.engine, prefs.cloud, prefs.modelBase, prefs.language, device]);

  // Switching engine/model invalidates the loaded one.
  useEffect(() => {
    if (providerRef.current) {
      void providerRef.current.dispose();
      providerRef.current = null;
    }
    setEngine({ phase: "none" });
  }, [prefs.engine, prefs.modelBase, prefs.cloud.baseUrl, prefs.cloud.model, prefs.cloud.apiKey, prefs.engine === "demo" ? prefs.language : ""]);

  const settings: CallSettings = {
    ...DEFAULT_SETTINGS,
    language: prefs.language,
    fullDuplex: prefs.fullDuplex,
    endpointMs: prefs.endpointMs,
  };
  const scenario = getScenario(prefs.scenarioId);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => view.name !== "call" && setView({ name: "setup" })}>
          Roleplay Studio
        </button>
        <nav>
          {view.name !== "call" && (
            <>
              <button className={view.name === "setup" ? "tab active" : "tab"} onClick={() => setView({ name: "setup" })}>Practice</button>
              <button className={view.name === "history" ? "tab active" : "tab"} onClick={() => setView({ name: "history" })}>History</button>
            </>
          )}
        </nav>
      </header>
      <main>
        {view.name === "setup" && (
          <SetupScreen
            prefs={prefs}
            updatePrefs={updatePrefs}
            device={device}
            engine={engine}
            onLoadEngine={loadEngine}
            onStart={() => providerRef.current && setView({ name: "call" })}
          />
        )}
        {view.name === "call" && providerRef.current && (
          <CallScreen
            provider={providerRef.current}
            scenario={scenario}
            settings={settings}
            prefs={prefs}
            speechInput={!!device?.speechInput && prefs.micOn}
            onEnded={record => setView({ name: "review", record })}
          />
        )}
        {view.name === "review" && (
          <ReviewScreen
            record={view.record}
            onBack={() => setView({ name: "setup" })}
            onRetry={r => {
              updatePrefs({ scenarioId: r.scenarioId, language: r.language });
              setView(providerRef.current ? { name: "call" } : { name: "setup" });
            }}
          />
        )}
        {view.name === "history" && <HistoryScreen onOpen={record => setView({ name: "review", record })} />}
      </main>
    </div>
  );
}
