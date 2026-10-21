import { useEffect, useRef, useState } from "react";
import { CallController, type CallSettings } from "../agent/CallController";
import { sttLang } from "../lib/lang";
import { formatDuration } from "../lib/scoring";
import { saveSession } from "../lib/storage";
import type { CallState, SessionRecord, TranscriptTurn, TurnMetrics } from "../lib/types";
import type { LLMProvider } from "../llm/provider";
import type { Prefs } from "../prefs";
import type { Scenario } from "../scenarios/scenarios";
import { WebSpeechInput } from "../speech/stt";
import { BrowserTTS, SilentTTS, speechOutputSupported } from "../speech/tts";

interface Props {
  provider: LLMProvider;
  scenario: Scenario;
  settings: CallSettings;
  prefs: Prefs;
  speechInput: boolean;
  onEnded: (record: SessionRecord) => void;
}

const STATE_LABEL: Record<CallState, string> = {
  idle: "Connecting…",
  listening: "Your turn: speak",
  thinking: "Buyer is thinking…",
  speaking: "Buyer is speaking",
  ended: "Call ended",
};

export function CallScreen({ provider, scenario, settings, prefs, speechInput, onEnded }: Props) {
  const [state, setState] = useState<CallState>("idle");
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [live, setLive] = useState("");
  const [partial, setPartial] = useState("");
  const [lastMetrics, setLastMetrics] = useState<TurnMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [draft, setDraft] = useState("");
  const [briefOpen, setBriefOpen] = useState(true);
  const ctrlRef = useRef<CallController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    const stt = speechInput ? new WebSpeechInput(sttLang(settings.language)) : null;
    const tts = prefs.voiceOn && speechOutputSupported() ? new BrowserTTS({ voiceURIs: prefs.voiceURIs, rate: prefs.rate }) : new SilentTTS();
    const ctrl: CallController = new CallController({
      llm: provider,
      stt,
      tts,
      scenario,
      settings,
      onEvent: e => {
        switch (e.type) {
          case "state":
            setState(e.state);
            break;
          case "transcript":
            setTurns(e.turns);
            void saveSession(ctrl.snapshot(provider.label));
            break;
          case "live":
            setLive(e.text);
            break;
          case "buyerPartial":
            setPartial(e.text);
            break;
          case "metrics":
            setLastMetrics(e.metrics);
            break;
          case "error":
            setError(e.message);
            break;
          case "ended": {
            const record = ctrl.snapshot(provider.label);
            void saveSession(record);
            onEndedRef.current(record);
            break;
          }
        }
      },
    });
    ctrlRef.current = ctrl;
    ctrl.start();

    let wakeLock: WakeLockSentinel | null = null;
    navigator.wakeLock?.request("screen").then(w => (wakeLock = w)).catch(() => {});
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    const tick = setInterval(() => setElapsed(Date.now() - ctrl.startedAt), 1000);

    return () => {
      clearInterval(tick);
      window.removeEventListener("beforeunload", beforeUnload);
      void wakeLock?.release().catch(() => {});
      if (ctrl.state !== "ended") ctrl.end("Left the call screen");
    };
    // A call is created once per mount; settings changes apply to the next call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, live, partial]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    ctrlRef.current?.submitRep(draft);
    setDraft("");
  };

  const remaining = settings.maxCallMs - elapsed;

  return (
    <div className="call">
      <div className="call-head">
        <div>
          <h2>{scenario.buyer.name} <span className="muted">· {scenario.buyer.role}, {scenario.buyer.company}</span></h2>
          <span className={`pill ${state}`} data-testid="call-state">{STATE_LABEL[state]}</span>
          <span className="muted small timer">{formatDuration(elapsed)}{remaining < 2 * 60 * 1000 ? ` · ${formatDuration(Math.max(remaining, 0))} left` : ""}</span>
        </div>
        <button className="danger" onClick={() => ctrlRef.current?.end("You ended the call")}>End call</button>
      </div>

      <details className="brief" open={briefOpen} onToggle={e => setBriefOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Your brief</summary>
        <p>{scenario.repBrief}</p>
      </details>

      {error && (
        <div className="error-banner" role="alert">
          {error} <button className="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="transcript" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            <span className="who">{t.role === "rep" ? "You" : scenario.buyer.name}</span>
            <p>{t.text}{t.interrupted ? " —" : ""}</p>
          </div>
        ))}
        {partial && state !== "ended" && (
          <div className="bubble buyer pending">
            <span className="who">{scenario.buyer.name}</span>
            <p>{partial}</p>
          </div>
        )}
        {live && (
          <div className="bubble rep pending">
            <span className="who">You</span>
            <p>{live}</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="composer" onSubmit={send}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={speechInput ? "Speak, or type here and press Enter" : "Type your reply and press Enter"}
          aria-label="Your reply"
        />
        <button className="primary" type="submit" disabled={!draft.trim()}>Send</button>
      </form>

      {prefs.showMetrics && lastMetrics && (
        <p className="metrics muted small" data-testid="metrics">
          First word {fmtMs(lastMetrics.firstTokenMs)} · first audio {fmtMs(lastMetrics.firstAudioMs)} ·{" "}
          {lastMetrics.tokensPerSec ? `${lastMetrics.tokensPerSec.toFixed(1)} tok/s` : "–"} · {provider.label}
        </p>
      )}
      {!prefs.fullDuplex && speechInput && <p className="muted small">Mic pauses while the buyer talks. Tick "headphones" in setup to interrupt mid-sentence.</p>}
    </div>
  );
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "–";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
