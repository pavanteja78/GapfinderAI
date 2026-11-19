import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";

const LEVELS = {
  weak: { label: "Weak", bar: "bg-weak", chip: "bg-weak/10 text-weak" },
  medium: { label: "Medium", bar: "bg-medium", chip: "bg-medium/10 text-medium" },
  strong: { label: "Strong", bar: "bg-strong", chip: "bg-strong/10 text-strong" },
  untested: { label: "Not tested", bar: "bg-mute/40", chip: "bg-mute/10 text-mute" },
};
const btn = "rounded-lg bg-brand px-4 py-2 font-semibold text-white transition hover:bg-brand/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const btn2 = "rounded-lg border border-ink/20 bg-white px-4 py-2 font-semibold transition hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const card = "rounded-xl border border-ink/10 bg-white p-5";
const input = "w-full rounded-lg border border-ink/20 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-brand";

const Chip = ({ level }) => (
  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVELS[level].chip}`}>{LEVELS[level].label}</span>
);
const Err = ({ msg }) => (msg ? <p role="alert" className="mt-3 rounded-lg bg-weak/10 px-3 py-2 text-sm text-weak">{msg}</p> : null);
const Source = ({ children }) => <span className="rounded bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">{children}</span>;

function Login({ onIn }) {
  const [f, setF] = useState({ username: "", password: "" });
  const [mode, setMode] = useState("login");
  const [err, setErr] = useState("");
  const go = async (e, creds) => {
    e?.preventDefault();
    try {
      const r = await api(creds || mode === "login" ? "/api/login" : "/api/register", { method: "POST", body: creds || f });
      setToken(r.token);
      onIn(r.username);
    } catch (x) { setErr(x.message); }
  };
  return (
    <main className="grid min-h-screen md:grid-cols-2">
      <section className="flex flex-col justify-center bg-ink px-8 py-14 text-white md:px-16">
        <h1 className="text-5xl font-extrabold leading-tight">Study what you don’t know.</h1>
        <p className="mt-5 max-w-md text-lg text-white/75">
          GapFinder tests you on your own notes, finds the topics holding you back, and builds a revision plan that updates as you improve.
        </p>
        <div className="mt-10 flex max-w-md overflow-hidden rounded-full text-sm font-semibold">
          <span className="w-1/3 bg-weak px-4 py-2">Weak</span>
          <span className="w-1/3 bg-medium px-4 py-2">Medium</span>
          <span className="w-1/3 bg-strong px-4 py-2">Strong</span>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-14">
        <form onSubmit={go} className="w-full max-w-sm space-y-4">
          <h2 className="text-2xl font-bold">{mode === "login" ? "Log in" : "Create account"}</h2>
          <label className="block text-sm font-medium">Username
            <input className={`${input} mt-1`} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          </label>
          <label className="block text-sm font-medium">Password
            <input type="password" className={`${input} mt-1`} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </label>
          <button className={`${btn} w-full`}>{mode === "login" ? "Log in" : "Sign up"}</button>
          <Err msg={err} />
          <p className="text-sm text-mute">
            <button type="button" className="font-semibold text-brand underline" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
              {mode === "login" ? "Create an account" : "Back to log in"}
            </button>
          </p>
        </form>
      </section>
    </main>
  );
}

function Upload({ data, reload, go }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const slots = [
    ["syllabus", "Syllabus", "The list of topics you’re examined on."],
    ["notes", "Notes and chapters", "Textbook chapters, class notes. Quizzes are built from these."],
    ["papers", "Past papers", "Used to see which topics appear most in exams."],
  ];
  const send = async (kind, files) => {
    if (!files.length) return;
    setBusy(kind); setErr("");
    const fd = new FormData();
    fd.append("kind", kind);
    [...files].forEach((f) => fd.append("files", f));
    try { await api("/api/upload", { method: "POST", body: fd }); await reload(); } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const sample = async () => {
    setBusy("sample"); setErr("");
    try { await api("/api/sample", { method: "POST" }); await reload(); } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const clear = async () => {
    if (!window.confirm("Delete all your uploaded material, quiz history and plan?")) return;
    setBusy("clear"); setErr("");
    try { await api("/api/reset", { method: "POST" }); await reload(); } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const build = async () => {
    setBusy("build"); setErr("");
    try { await api("/api/topics/build", { method: "POST" }); await reload(); go("topics"); } catch (e) { setErr(e.message); }
    setBusy("");
  };
  return (
    <div>
      <h2 className="text-3xl font-bold">Add your study material</h2>
      <p className="mt-1 max-w-xl text-mute">PDF or text files. Everything the app asks and explains comes from what you upload here.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {slots.map(([k, title, hint]) => (
          <label key={k} className={`${card} cursor-pointer border-dashed transition hover:border-brand focus-within:outline-2 focus-within:outline-brand`}>
            <h3 className="text-lg font-bold">{title}</h3>
            <p className="mt-1 text-sm text-mute">{hint}</p>
            <p className="mt-4 text-sm font-semibold text-brand">
              {busy === k ? "Reading files…" : data.counts[k] ? `${data.counts[k]} sections stored. Add more` : "Choose files"}
            </p>
            <input type="file" multiple accept=".pdf,.txt,.md" className="sr-only" onChange={(e) => send(k, e.target.files)} />
          </label>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
        <button className={btn2} onClick={sample} disabled={busy === "sample"}>{busy === "sample" ? "Loading sample…" : "Try with sample biology material"}</button>
        {(data.counts.syllabus + data.counts.notes + data.counts.papers > 0) && <button className="font-semibold text-weak underline" onClick={clear} disabled={busy === "clear"}>Clear my data</button>}
        {data.embedded > 0 ? (
          <span className="rounded-full bg-strong/10 px-3 py-1 font-medium text-strong">Semantic search on · {data.embedded} sections embedded</span>
        ) : null}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <button className={btn} disabled={!data.counts.syllabus || busy === "build"} onClick={build}>
          {busy === "build" ? "Building topic map…" : data.topics.length ? "Rebuild topic map" : "Build topic map"}
        </button>
        {!data.counts.syllabus && <span className="text-sm text-mute">Upload a syllabus to continue.</span>}
      </div>
      <Err msg={err} />
    </div>
  );
}

function TopicMap({ data, go }) {
  if (!data.topics.length) return <Empty text="No topics yet. Upload a syllabus and build the topic map." action={() => go("upload")} label="Go to upload" />;
  const units = data.topics.reduce((a, t) => ((a[t.unit] ||= []).push(t), a), {});
  const max = Math.max(1, ...data.topics.map((t) => t.freq));
  return (
    <div>
      <h2 className="text-3xl font-bold">Topic map</h2>
      <p className="mt-1 text-mute">Bars show how often each topic appears in your past papers.</p>
      <div className="mt-6 space-y-4">
        {Object.entries(units).map(([u, ts]) => (
          <section key={u} className={card}>
            <h3 className="text-lg font-bold">{u}</h3>
            <ul className="mt-3 divide-y divide-ink/10">
              {ts.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-4 py-2">
                  <span>{t.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-sm text-mute">
                    <span className="h-2 w-24 overflow-hidden rounded-full bg-ink/10">
                      <span className="block h-full bg-brand" style={{ width: `${(t.freq / max) * 100}%` }} />
                    </span>
                    {t.freq} {t.freq === 1 ? "question" : "questions"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <button className={`${btn} mt-6`} onClick={() => go("quiz")}>Take a diagnostic quiz</button>
    </div>
  );
}

const Empty = ({ text, action, label }) => (
  <div className={`${card} max-w-lg`}>
    <p>{text}</p>
    {action && <button className={`${btn} mt-4`} onClick={action}>{label}</button>}
  </div>
);

function Quiz({ data, reload, go }) {
  const [n, setN] = useState(8);
  const [quiz, setQuiz] = useState(null);
  const [ans, setAns] = useState({});
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!data.topics.length) return <Empty text="Build the topic map before taking a quiz." action={() => go("upload")} label="Go to upload" />;

  const start = async () => {
    setBusy(true); setErr(""); setRes(null); setAns({});
    try { setQuiz(await api("/api/quiz/generate", { method: "POST", body: { n } })); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const submit = async () => {
    setBusy(true);
    try { setRes(await api("/api/quiz/submit", { method: "POST", body: { quiz_id: quiz.quiz_id, answers: ans } })); await reload(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (res)
    return (
      <div>
        <h2 className="text-3xl font-bold">You scored {res.score} of {res.total}</h2>
        <div className="mt-6 space-y-4">
          {res.results.map((r) => (
            <article key={r.id} className={`${card} border-l-4 ${r.correct ? "border-l-strong" : "border-l-weak"}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b className={r.correct ? "text-strong" : "text-weak"}>{r.correct ? "Right" : "Wrong"}</b>
                <span className="text-mute">{r.topic}</span>
                <Source>{r.source}</Source>
              </div>
              <p className="mt-2 font-semibold">{r.question}</p>
              {!r.correct && <p className="mt-2 text-sm"><b>Your answer:</b> {r.options[r.chosen] ?? "None"}. <span className="text-mute">{r.why_chosen}</span></p>}
              <p className="mt-1 text-sm"><b>Correct answer:</b> {r.options[r.answer]}. <span className="text-mute">{r.why_correct}</span></p>
            </article>
          ))}
        </div>
        <div className="mt-6 flex gap-3">
          <button className={btn} onClick={() => go("gaps")}>See gap report</button>
          <button className={btn2} onClick={start}>Take another quiz</button>
        </div>
      </div>
    );

  if (!quiz)
    return (
      <div>
        <h2 className="text-3xl font-bold">Diagnostic quiz</h2>
        <p className="mt-1 max-w-xl text-mute">Questions come from your notes and cite the section they came from. Weak and exam-heavy topics are picked first.</p>
        <label className="mt-6 block text-sm font-medium">Number of questions
          <select className={`${input} mt-1 w-40`} value={n} onChange={(e) => setN(+e.target.value)}>
            {[5, 8, 10, 15].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <button className={`${btn} mt-4`} onClick={start} disabled={busy}>{busy ? "Writing questions from your notes…" : "Start quiz"}</button>
        <Err msg={err} />
      </div>
    );

  return (
    <div>
      <h2 className="text-3xl font-bold">Answer all questions</h2>
      <div className="mt-6 space-y-4">
        {quiz.questions.map((x, i) => (
          <fieldset key={x.id} className={card}>
            <legend className="sr-only">Question {i + 1}</legend>
            <p className="text-sm text-mute">{i + 1} of {quiz.questions.length} · {x.topic}</p>
            <p className="mt-1 font-semibold">{x.question}</p>
            <div className="mt-3 space-y-2">
              {x.options.map((o, j) => (
                <label key={j} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition ${ans[x.id] === j ? "border-brand bg-brand/5" : "border-ink/15 hover:bg-ink/5"}`}>
                  <input type="radio" name={`q${x.id}`} className="mt-1 accent-brand" checked={ans[x.id] === j} onChange={() => setAns({ ...ans, [x.id]: j })} />
                  <span>{o}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <button className={`${btn} mt-6`} disabled={busy} onClick={submit}>
        {busy ? "Checking…" : `Submit ${Object.keys(ans).length} of ${quiz.questions.length} answers`}
      </button>
      <Err msg={err} />
    </div>
  );
}

function Gaps({ data, go }) {
  const ts = data.topics;
  if (!ts.some((t) => t.level !== "untested")) return <Empty text="No results yet. Take a diagnostic quiz and your gap report appears here." action={() => go("quiz")} label="Take a quiz" />;
  const by = (l) => ts.filter((t) => t.level === l);
  return (
    <div>
      <h2 className="text-3xl font-bold">Gap report</h2>
      <div className="mt-5 flex h-4 overflow-hidden rounded-full bg-ink/10" role="img" aria-label="Share of topics by level">
        {["weak", "medium", "strong", "untested"].map((l) => (
          <div key={l} className={LEVELS[l].bar} style={{ width: `${(by(l).length / ts.length) * 100}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-sm text-mute">
        {["weak", "medium", "strong", "untested"].map((l) => <span key={l}>{by(l).length} {LEVELS[l].label.toLowerCase()}</span>)}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {["weak", "medium", "strong"].map((l) => (
          <section key={l}>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-bold"><span className={`h-3 w-3 rounded-full ${LEVELS[l].bar}`} />{LEVELS[l].label}</h3>
            <div className="space-y-3">
              {by(l).map((t) => (
                <article key={t.id} className={`${card} border-t-4 ${l === "weak" ? "border-t-weak" : l === "medium" ? "border-t-medium" : "border-t-strong"}`}>
                  <h4 className="font-semibold">{t.name}</h4>
                  <p className="text-xs text-mute">{t.unit} · {Math.round(t.mastery * 100)}% mastery</p>
                  <p className="mt-2 text-sm text-mute">{t.reason}</p>
                  {t.ai && <p className="mt-2"><Source>Diagnosis from your notes</Source></p>}
                </article>
              ))}
              {!by(l).length && <p className="text-sm text-mute">Nothing here yet.</p>}
            </div>
          </section>
        ))}
      </div>
      <button className={`${btn} mt-6`} onClick={() => go("plan")}>Build my revision plan</button>
    </div>
  );
}

function Plan({ data, go }) {
  const [days, setDays] = useState(5);
  const [hours, setHours] = useState(2);
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    setErr("");
    try { setPlan(await api(`/api/plan?days=${days}&hours=${hours}`)); } catch (e) { setErr(e.message); }
  }, [days, hours]);
  useEffect(() => { if (data.topics.length) load(); }, [data.topics.length]);
  if (!data.topics.length) return <Empty text="Build the topic map first." action={() => go("upload")} label="Go to upload" />;
  return (
    <div>
      <h2 className="text-3xl font-bold">Revision plan</h2>
      <p className="mt-1 text-mute">Weakest and most exam-heavy topics come first. The plan refreshes every time you retake a quiz.</p>
      <div className="mt-5 flex flex-wrap items-end gap-4">
        <label className="text-sm font-medium">Days until exam
          <input type="number" min="1" max="60" className={`${input} mt-1 w-28`} value={days} onChange={(e) => setDays(+e.target.value)} />
        </label>
        <label className="text-sm font-medium">Hours per day
          <input type="number" min="0.5" max="12" step="0.5" className={`${input} mt-1 w-28`} value={hours} onChange={(e) => setHours(+e.target.value)} />
        </label>
        <button className={btn} onClick={load}>Update plan</button>
      </div>
      <Err msg={err} />
      {plan?.summary && <p className="mt-5 max-w-2xl rounded-xl border-l-4 border-l-brand bg-white p-4">{plan.summary}</p>}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {plan?.days.map((d) => (
          <section key={d.day} className={card}>
            <h3 className="text-lg font-bold">Day {d.day}</h3>
            <ul className="mt-3 space-y-3">
              {d.items.map((it, i) => (
                <li key={i} className="flex gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${LEVELS[it.level].bar}`} />
                  <div>
                    <p className="font-semibold">{it.topic} <span className="font-normal text-mute">· {it.minutes} min</span></p>
                    <p className="text-sm text-mute">{it.action}. {it.focus}.</p>
                    {it.tip && <p className="mt-1 text-sm">{it.tip}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Explain({ data }) {
  const [q, setQ] = useState("");
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const ask = async (e, preset) => {
    e?.preventDefault();
    const question = preset || q;
    if (!question.trim()) return;
    setQ(""); setBusy(true);
    try {
      const r = await api("/api/explain", { method: "POST", body: { question } });
      setLog([{ question, ...r }, ...log]);
    } catch (x) { setLog([{ question, answer: x.message, sources: [] }, ...log]); }
    setBusy(false);
  };
  return (
    <div className="max-w-2xl">
      <h2 className="text-3xl font-bold">Explain a topic</h2>
      <p className="mt-1 text-mute">Answers come only from your uploaded material. If it isn’t covered, you’ll be told.</p>
      <form onSubmit={ask} className="mt-5 flex gap-2">
        <input className={input} placeholder="e.g. What happens in the light reaction?" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={btn} disabled={busy}>{busy ? "Looking…" : "Explain"}</button>
      </form>
      {data.topics.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.topics.slice(0, 5).map((t) => (
            <button key={t.id} type="button" disabled={busy} onClick={() => ask(null, `Explain ${t.name}`)}
              className="rounded-full border border-ink/15 bg-white px-3 py-1 text-sm transition hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand">{t.name}</button>
          ))}
        </div>
      )}
      <div className="mt-6 space-y-4">
        {log.map((m, i) => (
          <article key={i} className={card}>
            <p className="font-semibold">{m.question}</p>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{m.answer}</p>
            {!!m.sources.length && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-mute">
                Sources: {m.sources.map((s) => <Source key={s.n}>[{s.n}] {s.source}</Source>)}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function Progress({ go }) {
  const [p, setP] = useState(null);
  useEffect(() => { api("/api/progress").then(setP).catch(() => setP({ attempts: [] })); }, []);
  if (!p) return null;
  if (!p.attempts.length) return <Empty text="No attempts yet. Your improvement shows up here after your first quiz." action={() => go("quiz")} label="Take a quiz" />;
  const names = [...new Set(p.attempts.flatMap((a) => Object.keys(a.topics)))];
  const tone = (v) => (v == null ? "text-mute/50" : v < 40 ? "bg-weak/15 text-weak" : v < 75 ? "bg-medium/15 text-medium" : "bg-strong/15 text-strong");
  return (
    <div>
      <h2 className="text-3xl font-bold">Progress</h2>
      <section className={`${card} mt-6`}>
        <h3 className="font-bold">Score by attempt</h3>
        <div className="mt-4 flex h-40 items-end gap-3">
          {p.attempts.map((a, i) => {
            const pct = Math.round((a.score / a.total) * 100);
            return (
              <div key={a.id} className="flex h-full flex-1 flex-col justify-end text-center text-sm">
                <span className="font-semibold">{pct}%</span>
                <div className="rounded-t-md bg-brand" style={{ height: `${pct}%`, minHeight: 4 }} />
                <span className="mt-1 text-mute">#{i + 1}</span>
              </div>
            );
          })}
        </div>
      </section>
      <section className={`${card} mt-4 overflow-x-auto`}>
        <h3 className="font-bold">Topic accuracy across attempts</h3>
        <table className="mt-3 w-full text-left text-sm">
          <thead><tr className="text-mute"><th className="py-2 pr-4 font-medium">Topic</th>{p.attempts.map((a, i) => <th key={a.id} className="px-2 font-medium">#{i + 1}</th>)}</tr></thead>
          <tbody>
            {names.map((n) => (
              <tr key={n} className="border-t border-ink/10">
                <td className="py-2 pr-4">{n}</td>
                {p.attempts.map((a) => (
                  <td key={a.id} className="px-1 py-1"><span className={`block rounded px-2 py-1 text-center font-semibold ${tone(a.topics[n])}`}>{a.topics[n] != null ? `${a.topics[n]}%` : "–"}</span></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function HowItWorks() {
  const cols = [
    ["Retrieval: finds and decides", "bg-brand", [
      "Splits your files into sections and keeps the file and page for every one.",
      "Embeds each section (Gemini) so questions match by meaning, then blends in keyword matching.",
      "Picks the sections each quiz question and answer may use.",
      "Marks answers right or wrong by comparing with the stored answer.",
      "Sets weak, medium or strong from your results, and fixes the plan's order and minutes.",
    ]],
    ["Generation: writes, only from what was retrieved", "bg-ink", [
      "Turns the syllabus into a list of topics.",
      "Writes one quiz question per topic, and explains every option.",
      "Writes a short diagnosis of what you misunderstood in each topic.",
      "Adds a study tip to each item in your plan.",
      "Answers “Explain a topic” and says so when your material doesn’t cover it.",
    ]],
  ];
  return (
    <div className="max-w-4xl">
      <h2 className="text-3xl font-bold">How GapFinder works</h2>
      <p className="mt-1 text-mute">The AI never answers from memory. Every question and explanation is built from sections retrieved from your own files.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {cols.map(([title, bar, items]) => (
          <section key={title} className={`${card} border-t-4 ${bar === "bg-brand" ? "border-t-brand" : "border-t-ink"}`}>
            <h3 className="text-lg font-bold">{title}</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{items.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
        ))}
      </div>
      <section className={`${card} mt-4`}>
        <h3 className="text-lg font-bold">What keeps the two apart</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          <li>The model only sees retrieved excerpts. It returns an excerpt id, and the server turns it into the real file and page, so citations can’t be invented.</li>
          <li>If nothing in your material is close enough to a question, the app says so instead of guessing.</li>
          <li>Whether a topic is weak is decided by code from your answers, not by the model.</li>
        </ul>
      </section>
    </div>
  );
}

function Journey({ data, go }) {
  const diag = data.topics.some((t) => t.level !== "untested");
  const steps = [["upload", "Add material", data.counts.syllabus > 0 && data.counts.notes > 0], ["topics", "Topic map", data.topics.length > 0],
    ["quiz", "Diagnose", diag], ["gaps", "Gap report", diag], ["plan", "Plan", diag]];
  return (
    <ol className="mb-8 flex flex-wrap gap-2 text-sm" aria-label="Progress">
      {steps.map(([k, label, ok], i) => (
        <li key={k}>
          <button onClick={() => go(k)} className="flex items-center gap-2 rounded-full border border-ink/15 bg-white px-3 py-1.5 font-medium transition hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand">
            <span className={`grid h-5 w-5 place-items-center rounded-full text-xs font-bold text-white ${ok ? "bg-strong" : "bg-mute/50"}`}>{ok ? "✓" : i + 1}</span>
            {label}
          </button>
        </li>
      ))}
    </ol>
  );
}

const NAV = [["upload", "Material"], ["topics", "Topic map"], ["quiz", "Diagnostic quiz"], ["gaps", "Gap report"], ["plan", "Revision plan"], ["explain", "Explain a topic"], ["progress", "Progress"], ["how", "How it works"]];

export default function App() {
  const [user, setUser] = useState(getToken() ? "demo" : null);
  const [tab, setTab] = useState("upload");
  const [data, setData] = useState({ counts: { syllabus: 0, notes: 0, papers: 0 }, embedded: 0, topics: [] });
  const reload = useCallback(async () => {
    try { setData(await api("/api/topics")); } catch (e) { if (e.status === 401) { setToken(null); setUser(null); } }
  }, []);
  useEffect(() => { if (user) reload(); }, [user, reload]);
  if (!user) return <Login onIn={setUser} />;

  const screens = { upload: Upload, topics: TopicMap, quiz: Quiz, gaps: Gaps, plan: Plan, explain: Explain, progress: Progress, how: HowItWorks };
  const Screen = screens[tab];
  return (
    <div className="md:flex">
      <nav className="bg-ink px-3 py-3 text-white md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:px-5 md:py-8" aria-label="Main">
        <p className="px-2 font-display text-xl font-extrabold">GapFinder</p>
        <ul className="mt-3 flex gap-1 overflow-x-auto md:mt-8 md:flex-col">
          {NAV.map(([k, label]) => (
            <li key={k}>
              <button onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined}
                className={`w-full whitespace-nowrap rounded-lg px-3 py-2 text-left font-medium transition focus-visible:outline-2 focus-visible:outline-white ${tab === k ? "bg-white text-ink" : "text-white/80 hover:bg-white/10"}`}>
                {label}
              </button>
            </li>
          ))}
        </ul>
        <button className="mt-4 hidden px-3 text-sm text-white/60 underline md:block" onClick={() => { setToken(null); setUser(null); }}>Log out</button>
      </nav>
      <main className="min-h-screen flex-1 p-5 md:p-10">
        <Journey data={data} go={setTab} />
        <Screen data={data} reload={reload} go={setTab} />
      </main>
    </div>
  );
}