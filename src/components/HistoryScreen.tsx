import { useEffect, useState } from "react";
import { formatDuration } from "../lib/scoring";
import { deleteSession, downloadJSON, listSessions } from "../lib/storage";
import type { SessionRecord } from "../lib/types";

export function HistoryScreen({ onOpen }: { onOpen: (r: SessionRecord) => void }) {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);

  const refresh = () => void listSessions().then(setSessions);
  useEffect(refresh, []);

  if (sessions === null) return <p className="muted">Loading…</p>;

  return (
    <section className="card">
      <div className="row spread">
        <h2>Your practice history</h2>
        {sessions.length > 0 && <button onClick={() => downloadJSON("roleplay-history.json", sessions)}>Export all</button>}
      </div>
      <p className="muted small">Stored only in this browser. Clearing site data deletes it, so export to keep a copy.</p>
      {sessions.length === 0 && <p className="muted">No calls yet.</p>}
      <ul className="history">
        {sessions.map(s => {
          const passed = s.score?.filter(x => x.verdict === "good").length;
          return (
            <li key={s.id}>
              <button className="link" onClick={() => onOpen(s)}>
                <strong>{s.scenarioTitle}</strong>
                <span className="muted small">
                  {new Date(s.startedAt).toLocaleString()} · {formatDuration((s.endedAt ?? s.startedAt) - s.startedAt)} · {s.turns.filter(t => t.role === "rep").length} turns
                  {s.score ? ` · ${passed}/${s.score.length} checks` : " · unfinished"}
                </span>
              </button>
              <button
                className="link danger-text"
                onClick={async () => {
                  await deleteSession(s.id);
                  refresh();
                }}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
