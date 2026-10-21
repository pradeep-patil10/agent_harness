import { formatDuration } from "../lib/scoring";
import { downloadJSON } from "../lib/storage";
import type { SessionRecord } from "../lib/types";
import { getScenario } from "../scenarios/scenarios";

interface Props {
  record: SessionRecord;
  onBack: () => void;
  onRetry: (record: SessionRecord) => void;
}

export function ReviewScreen({ record, onBack, onRetry }: Props) {
  const buyer = getScenario(record.scenarioId).buyer.name;
  const score = record.score ?? [];
  const good = score.filter(s => s.verdict === "good").length;
  const m = record.metrics;
  const median = (xs: number[]) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const audio = median(m.map(x => x.firstAudioMs).filter((x): x is number => x !== null));
  const tps = median(m.map(x => x.tokensPerSec).filter((x): x is number => x !== null));
  const duration = (record.endedAt ?? record.startedAt) - record.startedAt;

  return (
    <div className="review">
      <section className="card">
        <h2>Call review</h2>
        <p className="muted">
          {record.scenarioTitle} · {new Date(record.startedAt).toLocaleString()} · {formatDuration(duration)}
          {record.endReason ? ` · ${record.endReason}` : ""}
        </p>
        <p className="summary" data-testid="score-summary">{good} of {score.length} checks passed</p>
        <ul className="scorecard">
          {score.map(s => (
            <li key={s.label} className={s.verdict}>
              <span className="dot" aria-hidden />
              <span className="label">{s.label}</span>
              <span className="value">{s.value}</span>
              {s.tip && <span className="tip">{s.tip}</span>}
            </li>
          ))}
        </ul>
        <p className="muted small">
          Scoring is a simple keyword and word-count heuristic, so treat it as a prompt for reflection, not a grade.
          {audio !== null && ` Median time to first audio: ${(audio / 1000).toFixed(1)} s.`}
          {tps !== null && ` Median speed: ${tps.toFixed(1)} tok/s.`} Engine: {record.engineLabel}.
        </p>
        <div className="row">
          <button className="primary" onClick={() => onRetry(record)}>Try this scenario again</button>
          <button onClick={onBack}>Back to setup</button>
          <button onClick={() => downloadJSON(`${record.id}.json`, record)}>Export JSON</button>
        </div>
      </section>

      <section className="card">
        <h2>Transcript</h2>
        <div className="transcript static">
          {record.turns.map((t, i) => (
            <div key={i} className={`bubble ${t.role}`}>
              <span className="who">{t.role === "rep" ? "You" : buyer} · {formatDuration(t.at)}</span>
              <p>{t.text}{t.interrupted ? " — (you interrupted)" : ""}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
