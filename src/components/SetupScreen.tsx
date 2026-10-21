import { useEffect, useState } from "react";
import type { DeviceReport } from "../lib/capabilities";
import { pickVoice } from "../lib/lang";
import type { LanguageMode } from "../lib/types";
import { MODELS, findModel } from "../llm/catalog";
import type { EngineKind, Prefs } from "../prefs";
import { SCENARIOS } from "../scenarios/scenarios";
import { loadVoices } from "../speech/tts";

export type EngineStatus =
  | { phase: "none" }
  | { phase: "loading"; progress: number; text: string; label: string }
  | { phase: "ready"; label: string }
  | { phase: "error"; message: string };

interface Props {
  prefs: Prefs;
  updatePrefs: (p: Partial<Prefs>) => void;
  device: DeviceReport | null;
  engine: EngineStatus;
  onLoadEngine: () => void;
  onStart: () => void;
}

const LANGS: { id: LanguageMode; label: string }[] = [
  { id: "en", label: "English (India)" },
  { id: "hinglish", label: "Hinglish (Hindi + English)" },
  { id: "hi", label: "Hindi" },
];

export function SetupScreen({ prefs, updatePrefs, device, engine, onLoadEngine, onStart }: Props) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [cached, setCached] = useState<boolean | null>(null);
  const model = findModel(prefs.modelBase);
  const f16 = device?.shaderF16 ?? true;

  useEffect(() => {
    void loadVoices().then(setVoices);
  }, []);

  useEffect(() => {
    if (prefs.engine !== "ondevice") return;
    let live = true;
    setCached(null);
    void import("../llm/webllm").then(m => m.isModelCached(model, f16)).then(c => live && setCached(c));
    return () => {
      live = false;
    };
  }, [prefs.engine, model, f16, engine.phase]);

  const ready = engine.phase === "ready";
  const loading = engine.phase === "loading";
  const needLangs = prefs.language === "en" ? ["en-IN"] : prefs.language === "hi" ? ["hi-IN"] : ["hi-IN", "en-IN"];

  return (
    <div className="setup">
      <section className="card">
        <h2>1 · Pick a scenario</h2>
        <div className="scenario-grid">
          {SCENARIOS.map(s => (
            <button
              key={s.id}
              className={`scenario ${prefs.scenarioId === s.id ? "selected" : ""}`}
              onClick={() => updatePrefs({ scenarioId: s.id })}
            >
              <span className={`badge ${s.difficulty}`}>{s.difficulty}</span>
              <strong>{s.title}</strong>
              <span className="muted">{s.buyer.name} · {s.buyer.role}, {s.buyer.company}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span>Language</span>
          <select value={prefs.language} onChange={e => updatePrefs({ language: e.target.value as LanguageMode })}>
            {LANGS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        {prefs.language !== "en" && prefs.engine === "ondevice" && model.hindi === "poor" && (
          <p className="warn">{model.label} handles Hindi poorly. Try Gemma 2 2B, or a cloud model for the best Hindi.</p>
        )}
      </section>

      <section className="card">
        <h2>2 · AI engine</h2>
        <div className="segmented" role="radiogroup">
          {([
            ["ondevice", "On this laptop"],
            ["cloud", "Cloud model"],
            ["demo", "Demo (no AI)"],
          ] as [EngineKind, string][]).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={prefs.engine === id} className={prefs.engine === id ? "on" : ""} onClick={() => updatePrefs({ engine: id })}>
              {label}
            </button>
          ))}
        </div>

        {prefs.engine === "ondevice" && (
          <>
            <label className="field">
              <span>Model</span>
              <select value={model.base} onChange={e => updatePrefs({ modelBase: e.target.value })}>
                {MODELS.map(m => (
                  <option key={m.base} value={m.base}>
                    {m.label} · {((f16 ? m.vramMB.f16 : m.vramMB.f32) / 1024).toFixed(1)} GB GPU memory
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              {model.note} {cached === true ? "Already downloaded on this device." : cached === false ? "Downloads once, then loads from cache." : ""}
            </p>
          </>
        )}

        {prefs.engine === "cloud" && (
          <div className="cloud">
            <label className="field">
              <span>OpenAI-compatible base URL</span>
              <input value={prefs.cloud.baseUrl} onChange={e => updatePrefs({ cloud: { ...prefs.cloud, baseUrl: e.target.value } })} placeholder="https://openrouter.ai/api/v1" />
            </label>
            <label className="field">
              <span>Model</span>
              <input value={prefs.cloud.model} onChange={e => updatePrefs({ cloud: { ...prefs.cloud, model: e.target.value } })} />
            </label>
            <label className="field">
              <span>API key</span>
              <input type="password" value={prefs.cloud.apiKey} onChange={e => updatePrefs({ cloud: { ...prefs.cloud, apiKey: e.target.value } })} placeholder="Stored only in this browser" />
            </label>
            <p className="muted small">Best Hindi and works on any laptop. Your key is stored in this browser's local storage.</p>
          </div>
        )}

        {prefs.engine === "demo" && <p className="muted small">A scripted buyer with fixed lines. Use it to test your mic and speakers without downloading anything.</p>}

        <div className="engine-row">
          <button className="primary" disabled={loading || ready} onClick={onLoadEngine}>
            {ready ? "Ready ✓" : loading ? "Loading…" : prefs.engine === "ondevice" && cached === false ? "Download & load" : "Load"}
          </button>
          {engine.phase === "loading" && (
            <div className="progress" aria-label="Loading progress">
              <div className="bar"><div style={{ width: `${Math.round(engine.progress * 100)}%` }} /></div>
              <span className="muted small">{engine.text}</span>
            </div>
          )}
          {engine.phase === "error" && <p className="error">{engine.message}</p>}
        </div>
      </section>

      <section className="card">
        <h2>3 · Audio</h2>
        <label className="check">
          <input type="checkbox" checked={prefs.micOn} onChange={e => updatePrefs({ micOn: e.target.checked })} disabled={!device?.speechInput} />
          Speak with the microphone {device && !device.speechInput && <span className="muted">(not supported here; type instead)</span>}
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.voiceOn} onChange={e => updatePrefs({ voiceOn: e.target.checked })} />
          Buyer speaks out loud
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.fullDuplex} onChange={e => updatePrefs({ fullDuplex: e.target.checked })} />
          I'm wearing headphones (lets you interrupt the buyer mid-sentence)
        </label>
        {prefs.voiceOn &&
          needLangs.map(lang => {
            const options = voices.filter(v => v.lang.replace("_", "-").toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()) && !/undefined/i.test(v.name));
            const auto = pickVoice(voices, lang);
            return (
              <label className="field" key={lang}>
                <span>{lang === "hi-IN" ? "Hindi voice" : "English voice"}</span>
                <select value={prefs.voiceURIs[lang] ?? ""} onChange={e => updatePrefs({ voiceURIs: { ...prefs.voiceURIs, [lang]: e.target.value || undefined } })}>
                  <option value="">Auto{auto ? ` (${auto.name})` : " (none found)"}</option>
                  {options.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}
                </select>
              </label>
            );
          })}
        <label className="field">
          <span>Pause before the buyer replies: {(prefs.endpointMs / 1000).toFixed(1)} s</span>
          <input type="range" min={500} max={2500} step={100} value={prefs.endpointMs} onChange={e => updatePrefs({ endpointMs: Number(e.target.value) })} />
        </label>
      </section>

      {device && device.notes.length > 0 && (
        <section className="card notes">
          {device.notes.map(n => <p key={n} className="small">{n}</p>)}
          {device.gpuDescription && <p className="muted small">GPU: {device.gpuVendor} {device.gpuDescription}</p>}
        </section>
      )}

      <div className="start-row">
        <button className="primary big" disabled={!ready} onClick={onStart}>
          Start call
        </button>
        {!ready && <span className="muted small">Load an AI engine first.</span>}
      </div>
    </div>
  );
}
