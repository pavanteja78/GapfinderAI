import hashlib, io, json, math, os, pathlib, re, secrets, time, urllib.request
from collections import Counter
from typing import List

from groq import Groq
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader
from sqlalchemy.pool import NullPool
from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, Text, create_engine, func, text

load_dotenv()
MODEL = os.getenv("MODEL", "openai/gpt-oss-120b")
_groq = None

def groq_client():
    global _groq
    if _groq is None:
        _groq = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _groq

app = FastAPI(title="GapFinder AI")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","), allow_methods=["*"], allow_headers=["*"])

DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or "sqlite:///gapfinder.db"
for old in ("postgres://", "postgresql://"):
    if DATABASE_URL.startswith(old):
        DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len(old):]
engine = create_engine(DATABASE_URL, pool_pre_ping=True,
                       poolclass=NullPool if os.getenv("VERCEL") else None,
                       connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})

meta = MetaData()
def pk():
    return Column("id", Integer, primary_key=True, autoincrement=True)

Table("users", meta, pk(), Column("username", String(80), unique=True), Column("salt", String(32)), Column("pw", String(128)))
Table("tokens", meta, Column("token", String(64), primary_key=True), Column("user_id", Integer, index=True))
Table("chunks", meta, pk(), Column("user_id", Integer, index=True), Column("kind", String(16)),
      Column("source", Text), Column("text", Text), Column("emb", Text))
Table("topics", meta, pk(), Column("user_id", Integer, index=True), Column("unit", Text), Column("name", Text),
      Column("freq", Integer, server_default="0"))
Table("quizzes", meta, pk(), Column("user_id", Integer, index=True), Column("data", Text))
Table("attempts", meta, pk(), Column("user_id", Integer, index=True), Column("created", DateTime, server_default=func.now()),
      Column("score", Integer), Column("total", Integer))
Table("answers", meta, pk(), Column("user_id", Integer, index=True), Column("attempt_id", Integer, index=True),
      Column("topic_id", Integer, index=True), Column("correct", Integer), Column("question", Text), Column("source", Text))
Table("diagnoses", meta, Column("topic_id", Integer, primary_key=True, autoincrement=False), Column("text", Text))
Table("plan_cache", meta, pk(), Column("user_id", Integer, index=True), Column("plan_key", String(32)), Column("data", Text))

def _bind(sql, a):
    n = iter(range(len(a) + 1))
    return text(re.sub(r"\?", lambda _: f":p{next(n)}", sql)), {f"p{k}": v for k, v in enumerate(a)}

def q(sql, a=()):
    stmt, params = _bind(sql, a)
    with engine.connect() as c:
        return [dict(r._mapping) for r in c.execute(stmt, params)]

def ex(sql, a=()):
    m = re.match(r"\s*insert\s+into\s+(\w+)", sql, re.I)
    wants_id = bool(m) and m.group(1).lower() not in ("tokens", "diagnoses")
    stmt, params = _bind(sql + (" returning id" if wants_id else ""), a)
    with engine.begin() as c:
        r = c.execute(stmt, params)
        return r.scalar() if wants_id else None

def hash_pw(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 100_000).hex()

def init():
    meta.create_all(engine)
    if not q("select id from users where username='demo'"):
        ex("insert into users(username,salt,pw) values('demo','s4lt',?)", (hash_pw("demo123", "s4lt"),))

class Creds(BaseModel):
    username: str
    password: str

def new_token(uid):
    t = secrets.token_hex(24)
    ex("insert into tokens(token,user_id) values(?,?)", (t, uid))
    return t

@app.post("/api/login")
def login(c: Creds):
    u = q("select * from users where username=?", (c.username,))
    if not u or u[0]["pw"] != hash_pw(c.password, u[0]["salt"]):
        raise HTTPException(401, "Wrong username or password")
    return {"token": new_token(u[0]["id"]), "username": c.username}

@app.post("/api/register")
def register(c: Creds):
    if q("select id from users where username=?", (c.username,)):
        raise HTTPException(400, "Username already taken")
    salt = secrets.token_hex(4)
    uid = ex("insert into users(username,salt,pw) values(?,?,?)", (c.username, salt, hash_pw(c.password, salt)))
    return {"token": new_token(uid), "username": c.username}

def user(authorization: str = Header("")):
    r = q("select user_id from tokens where token=?", (authorization.replace("Bearer ", ""),))
    if not r:
        raise HTTPException(401, "Please log in again")
    return r[0]["user_id"]

STOP = set("the a an of and or to in is are for on with as by at from that this it be was were which what".split())

def tok(s):
    return [w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP and len(w) > 1]

def rank(query, docs):
    D = [tok(d) for d in docs]
    N = max(len(D), 1)
    df = Counter()
    for d in D:
        df.update(set(d))
    qs = set(tok(query))
    out = []
    for d in D:
        tf = Counter(d)
        s = sum((1 + math.log(tf[w])) * math.log(1 + N / df[w]) for w in qs if tf[w])
        out.append(s / math.sqrt(len(d) + 1))
    return out

EMBED_MODEL = os.getenv("EMBED_MODEL", "gemini-embedding-001")
SIM_MIN = float(os.getenv("SIM_MIN", "0.5"))
_qcache = {}

def unit(v):
    n = math.sqrt(sum(x * x for x in v)) or 1
    return [round(x / n, 5) for x in v]

def embed(texts, task):
    key = os.getenv("GEMINI_API_KEY")
    out = []
    for i in range(0, len(texts), 50):
        batch = texts[i:i + 50]
        if not key:
            out += [None] * len(batch)
            continue
        body = json.dumps({"requests": [{"model": f"models/{EMBED_MODEL}", "content": {"parts": [{"text": t[:6000]}]},
                                         "taskType": task, "outputDimensionality": 768} for t in batch]}).encode()
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{EMBED_MODEL}:batchEmbedContents", body,
            {"Content-Type": "application/json", "x-goog-api-key": key})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    out += [unit(e["values"]) for e in json.load(r)["embeddings"]]
                break
            except Exception:
                if attempt == 2:
                    out += [None] * len(batch)
                else:
                    time.sleep(3 * (attempt + 1))
    return out

def retrieve(uid, query, kinds, k=4):
    rows = [r for r in q("select * from chunks where user_id=?", (uid,)) if r["kind"] in kinds]
    if not rows:
        return []
    kw = rank(query, [r["text"] for r in rows])
    top_kw = max(kw) or 1
    if query not in _qcache:
        v = embed([query], "RETRIEVAL_QUERY")[0]
        if v:
            _qcache[query] = v
    qv = _qcache.get(query)
    scored = []
    for r, s in zip(rows, kw):
        if qv and r.get("emb"):
            sim = sum(a * b for a, b in zip(qv, json.loads(r["emb"])))
            if sim >= SIM_MIN:
                scored.append((0.8 * sim + 0.2 * s / top_kw, r))
        elif s > 0:
            scored.append((0.5 * s / top_kw, r))
    scored.sort(key=lambda x: -x[0])
    return [r for _, r in scored[:k]]

def chunk(text, kind):
    if kind == "papers":
        parts = re.split(r"\n\s*(?=(?:Q\.?\s*)?\d{1,2}[\.\)]\s)", text)
    else:
        parts = re.split(r"\n\s*\n", text)
    out, buf = [], ""
    for p in (x.strip() for x in parts):
        if not p:
            continue
        if kind == "papers":
            out.append(p[:1200])
            continue
        first = p.split("\n", 1)[0].strip()
        starts_section = len(first) <= 80 and bool(HEAD.match(first))
        if buf and (len(buf) + len(p) > 900 or starts_section):
            out.append(buf)
            buf = ""
        buf += ("\n" if buf else "") + p
    if buf:
        out.append(buf)
    final = []
    for c in out:
        final += [c[i:i + 1100] for i in range(0, len(c), 1000)] if len(c) > 1200 else [c]
    return final

def chat(system, user_msg, max_tokens=1500):
    if not os.getenv("GROQ_API_KEY"):
        raise HTTPException(503, "GROQ_API_KEY is not set. Put it in backend/.env, then stop and restart uvicorn.")
    for attempt in range(3):
        try:
            extra = {}
            if MODEL.startswith("openai/gpt-oss"):
                extra = {"extra_body": {"reasoning_effort": "low"}}
            r = groq_client().chat.completions.create(
                model=MODEL, temperature=0.3, max_tokens=max_tokens + (1500 if extra else 0),
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}], **extra)
            return r.choices[0].message.content or ""
        except Exception as e:
            print("LLM error:", repr(e))
            if ("rate" in str(e).lower() or "429" in str(e)) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            raise HTTPException(503, f"AI error: {str(e)[:300]}")

def llm_json(system, user_msg, max_tokens=3000):
    for attempt in range(2):
        m = re.search(r"[\[{].*[\]}]", chat(system, user_msg, max_tokens), re.S)
        try:
            return json.loads(m.group(0))
        except Exception:
            continue
    raise HTTPException(502, "The AI returned an unreadable answer. Try again.")

HEAD = re.compile(r"^(chapter|section|unit|topic|lesson|part|\d+(\.\d+)*[\.\):]?\s)", re.I)

def heading(c):
    first = c.split("\n", 1)[0].strip()
    return first[:70] if len(first) <= 80 and HEAD.match(first) else None

def store_chunks(uid, kind, pages):
    items = []
    for label, text_ in pages:
        for n, c in enumerate(chunk(text_, kind), 1):
            h = heading(c) if kind != "papers" else None
            src = label if len(pages) > 1 else (label if h else f"{label}, part {n}")
            items.append((f"{src} · {h}" if h else src, c))
    vecs = [None] * len(items) if kind == "papers" else embed([c for _, c in items], "RETRIEVAL_DOCUMENT")
    for (src, c), v in zip(items, vecs):
        ex("insert into chunks(user_id,kind,source,text,emb) values(?,?,?,?,?)", (uid, kind, src, c, json.dumps(v) if v else None))
    return len(items)

@app.post("/api/upload")
async def upload(kind: str = Form(...), files: List[UploadFile] = File(...), uid=Depends(user)):
    if kind not in ("syllabus", "notes", "papers"):
        raise HTTPException(400, "kind must be syllabus, notes or papers")
    added = 0
    for f in files:
        raw = await f.read()
        if f.filename.lower().endswith(".pdf"):
            pages = [(f"{f.filename}, p.{i}", p.extract_text() or "") for i, p in enumerate(PdfReader(io.BytesIO(raw)).pages, 1)]
        else:
            pages = [(f.filename, raw.decode("utf-8", "ignore"))]
        added += store_chunks(uid, kind, pages)
    return {"added": added}

@app.post("/api/sample")
def load_sample(uid=Depends(user)):
    d = pathlib.Path(__file__).parent / "sample"
    files = (("syllabus", "syllabus.txt"), ("notes", "biology_notes.txt"), ("papers", "past_paper.txt"))
    out = {}
    for k, fn in files:
        if q("select id from chunks where user_id=? and kind=? and source like ?", (uid, k, fn + "%")):
            out[k] = 0
        else:
            out[k] = store_chunks(uid, k, [(fn, (d / fn).read_text(encoding="utf-8"))])
    return out

@app.post("/api/reset")
def reset(uid=Depends(user)):
    ex("delete from diagnoses where topic_id in (select id from topics where user_id=?)", (uid,))
    for t in ("chunks", "topics", "quizzes", "attempts", "answers", "plan_cache"):
        ex(f"delete from {t} where user_id=?", (uid,))
    return {"ok": True}

@app.post("/api/topics/build")
def build_topics(uid=Depends(user)):
    syl = [r["text"] for r in q("select text from chunks where user_id=? and kind='syllabus' order by id", (uid,))]
    if not syl:
        raise HTTPException(400, "Upload a syllabus first")
    items = llm_json(
        "You turn a syllabus into a flat topic list. Use only what the syllabus text says. "
        'Return JSON only: [{"unit": "...", "topic": "..."}], at most 40 items, concrete and testable.',
        "\n\n".join(syl)[:14000])
    ex_ids = [r["id"] for r in q("select id from topics where user_id=?", (uid,))]
    if ex_ids:
        ex("delete from topics where user_id=?", (uid,))
    ids = [ex("insert into topics(user_id,unit,name) values(?,?,?)", (uid, i.get("unit", "General"), i["topic"]))
           for i in items if i.get("topic")]
    names = [f'{i.get("unit", "")} {i["topic"]}' for i in items if i.get("topic")]
    for p in q("select text from chunks where user_id=? and kind='papers'", (uid,)):
        sc = rank(p["text"], names)
        if sc and max(sc) > 0:
            ex("update topics set freq=freq+1 where id=?", (ids[sc.index(max(sc))],))
    return {"topics": len(ids)}

def topic_stats(uid):
    out = []
    for t in q("select * from topics where user_id=? order by id", (uid,)):
        rows = q("select correct,question,source,attempt_id from answers where topic_id=? order by id", (t["id"],))
        m = None
        for r in rows:
            m = r["correct"] if m is None else 0.5 * m + 0.5 * r["correct"]
        last = rows[-1]["attempt_id"] if rows else None
        cur = [r for r in rows if r["attempt_id"] == last]
        missed = [r for r in cur if not r["correct"]]
        level = "untested" if m is None else "weak" if m < 0.4 else "medium" if m < 0.75 else "strong"
        d = q("select text from diagnoses where topic_id=?", (t["id"],))
        if m is None:
            reason = "Not tested yet. Take a diagnostic quiz to find out."
        else:
            reason = f"Latest attempt: {len(cur) - len(missed)} of {len(cur)} right."
            if d:
                reason += " " + d[0]["text"]
            elif missed:
                reason += " Missed: " + "; ".join(f"“{r['question'][:90]}” (see {r['source']})" for r in missed[:2])
        out.append({**t, "mastery": m, "level": level, "reason": reason, "missed": missed, "ai": bool(d)})
    return out

@app.get("/api/topics")
def topics(uid=Depends(user)):
    counts = {k: 0 for k in ("syllabus", "notes", "papers")}
    for r in q("select kind,count(*) n from chunks where user_id=? group by kind", (uid,)):
        counts[r["kind"]] = r["n"]
    emb = q("select count(*) n from chunks where user_id=? and emb is not null", (uid,))[0]["n"]
    return {"counts": counts, "embedded": emb, "topics": [{k: v for k, v in t.items() if k != "missed"} for t in topic_stats(uid)]}

class QuizReq(BaseModel):
    n: int = 8

@app.post("/api/quiz/generate")
def gen_quiz(req: QuizReq, uid=Depends(user)):
    ts = topic_stats(uid)
    if not ts:
        raise HTTPException(400, "Build the topic map first")
    ts.sort(key=lambda t: -((1 - (t["mastery"] if t["mastery"] is not None else 0.3)) * (1 + t["freq"])))
    picked, ctx, allowed = ts[:max(1, min(req.n, 15))], [], {}
    for t in picked:
        hits = retrieve(uid, f'{t["unit"]} {t["name"]}', ["notes"], 2) or retrieve(uid, t["name"], ["syllabus"], 2)
        if not hits:
            continue
        for h in hits:
            allowed[h["id"]] = h["source"]
        ctx.append(f'### topic_id={t["id"]} | {t["name"]}\n' +
                   "\n".join(f'[chunk {h["id"]}] {h["text"][:600]}' for h in hits))
    if not ctx:
        raise HTTPException(400, "Upload notes or textbook chapters first")
    items = llm_json(
        "Write one multiple-choice question per topic, using ONLY the excerpts given for that topic. "
        "Do not use outside knowledge. Four options, exactly one correct. "
        'Return JSON only: [{"topic_id":int,"chunk_id":int,"question":"","options":["","","",""],"answer":0-3,'
        '"explanations":["why option 0 is right or wrong","...","...","..."]}]. '
        "chunk_id must be the excerpt that supports the answer.",
        "\n\n".join(ctx), 4000)
    names = {t["id"]: t["name"] for t in picked}
    qs = []
    for i in items:
        try:
            if i["chunk_id"] in allowed and i["topic_id"] in names and len(i["options"]) == 4:
                qs.append({"id": len(qs), "topic_id": i["topic_id"], "topic": names[i["topic_id"]],
                           "question": i["question"], "options": i["options"], "answer": int(i["answer"]),
                           "explanations": i["explanations"], "source": allowed[i["chunk_id"]]})
        except KeyError:
            continue
    if not qs:
        raise HTTPException(502, "Could not build grounded questions. Try again.")
    qid = ex("insert into quizzes(user_id,data) values(?,?)", (uid, json.dumps(qs)))
    return {"quiz_id": qid, "questions": [{k: v for k, v in x.items() if k not in ("answer", "explanations")} for x in qs]}

def diagnose(uid, results):
    by = {}
    for r in results:
        by.setdefault(r["topic_id"], []).append(r)
    blocks = []
    for tid, rs in by.items():
        ctx = retrieve(uid, rs[0]["topic"], ["notes"], 2)
        ev = "\n".join(
            f"- {'RIGHT' if r['correct'] else 'WRONG'}: {r['question']} | student chose: "
            f"{r['options'][r['chosen']] if r['chosen'] >= 0 else 'skipped'} | correct: {r['options'][r['answer']]} | note: {r['why_chosen']}"
            for r in rs)
        blocks.append(f"### topic_id={tid} | {rs[0]['topic']}\nSource excerpts:\n" +
                      "\n".join(f"- ({c['source']}) {c['text'][:400]}" for c in ctx) + f"\nQuiz evidence:\n{ev}")
    try:
        out = llm_json(
            "You are a study diagnostician. For each topic, using ONLY the excerpts and quiz evidence given, write "
            "1-2 plain sentences naming the specific concept the student is missing or misreading (or what they "
            "clearly know, if all answers were right). No outside knowledge. "
            'Return JSON only: {"<topic_id>": "text"}.', "\n\n".join(blocks), 2000)
        for tid, text in out.items():
            ex("delete from diagnoses where topic_id=?", (int(tid),))
            ex("insert into diagnoses(topic_id,text) values(?,?)", (int(tid), str(text)))
    except Exception:
        pass

class Submit(BaseModel):
    quiz_id: int
    answers: dict

@app.post("/api/quiz/submit")
def submit(s: Submit, uid=Depends(user)):
    row = q("select data from quizzes where id=? and user_id=?", (s.quiz_id, uid))
    if not row:
        raise HTTPException(404, "Quiz not found")
    qs = json.loads(row[0]["data"])
    aid = ex("insert into attempts(user_id,score,total) values(?,?,?)", (uid, 0, len(qs)))
    results, score = [], 0
    for x in qs:
        chosen = s.answers.get(str(x["id"]), -1)
        ok = int(chosen == x["answer"])
        score += ok
        ex("insert into answers(user_id,attempt_id,topic_id,correct,question,source) values(?,?,?,?,?,?)",
           (uid, aid, x["topic_id"], ok, x["question"], x["source"]))
        results.append({"id": x["id"], "topic_id": x["topic_id"], "topic": x["topic"], "question": x["question"], "options": x["options"],
                        "chosen": chosen, "answer": x["answer"], "correct": bool(ok), "source": x["source"],
                        "why_chosen": x["explanations"][chosen] if chosen >= 0 else "You skipped this one.",
                        "why_correct": x["explanations"][x["answer"]]})
    ex("update attempts set score=? where id=?", (score, aid))
    diagnose(uid, results)
    return {"score": score, "total": len(qs), "results": results}

def plan_advice(uid, alloc):
    key = hashlib.md5(json.dumps([(t["id"], m, t["level"], round(t["mastery"] or 0, 2), t["freq"]) for t, m, _ in alloc]).encode()).hexdigest()
    hit = q("select data from plan_cache where user_id=? and plan_key=?", (uid, key))
    if hit:
        return json.loads(hit[0]["data"])
    blocks = []
    for t, m, _ in alloc:
        ctx = retrieve(uid, f'{t["unit"]} {t["name"]}', ["notes"], 2)
        blocks.append(f'### {t["name"]} | level={t["level"]} | {m} min | in {t["freq"]} past-paper questions\n'
                      f'Diagnosis: {t["reason"]}\n' + "\n".join(f'- ({c["source"]}) {c["text"][:350]}' for c in ctx))
    try:
        data = llm_json(
            "You write coaching notes for a revision plan whose order and minutes are already decided. Using ONLY the "
            "diagnosis and excerpts given, write one concrete tip per topic (max 25 words: what to do in the session "
            "and which idea to focus on), plus a 2-sentence summary of the priority order and why. "
            'Return JSON only: {"summary":"","tips":{"<exact topic name>":"tip"}}.', "\n\n".join(blocks), 3000)
    except Exception:
        return {"summary": "", "tips": {}}
    ex("insert into plan_cache(user_id,plan_key,data) values(?,?,?)", (uid, key, json.dumps(data)))
    return data

@app.get("/api/plan")
def plan(days: int = 5, hours: float = 2, uid=Depends(user)):
    ts = topic_stats(uid)
    if not ts:
        raise HTTPException(400, "Build the topic map first")
    days, hours = max(1, min(days, 60)), max(0.5, min(hours, 12))
    total, cap = int(days * hours * 60), int(hours * 60)
    cand = [t for t in ts if t["level"] != "strong"] or ts
    for t in cand:
        t["w"] = (1 - (t["mastery"] if t["mastery"] is not None else 0.3)) * (1 + t["freq"])
    cand.sort(key=lambda t: -t["w"])
    sw = sum(t["w"] for t in cand) or 1
    action = {"weak": "Re-learn from your notes, then retest", "medium": "Practice questions and fix slips",
              "untested": "Skim notes, then take a diagnostic", "strong": "Light recap"}
    alloc, left = [], total
    for t in cand:
        m = min(left, max(15, round(total * t["w"] / sw / 5) * 5))
        if m < 10:
            break
        left -= m
        if t["missed"]:
            focus = "Review " + ", ".join(sorted({r["source"] for r in t["missed"]}))
        else:
            hit = retrieve(uid, f'{t["unit"]} {t["name"]}', ["notes", "syllabus"], 1)
            focus = f'Read {hit[0]["source"]}' if hit else "Read your notes on this topic"
        alloc.append((t, m, focus))
    advice = plan_advice(uid, alloc)
    out, d = [{"day": i + 1, "items": [], "left": cap} for i in range(days)], 0
    for t, m, focus in alloc:
        while m > 0 and d < days:
            take = min(m, out[d]["left"])
            if take > 0:
                out[d]["items"].append({"topic": t["name"], "level": t["level"], "minutes": take,
                                        "action": action[t["level"]], "focus": focus,
                                        "tip": advice.get("tips", {}).get(t["name"], "")})
                out[d]["left"] -= take
                m -= take
            if out[d]["left"] == 0:
                d += 1
    return {"total_minutes": total, "summary": advice.get("summary", ""), "days": [{"day": x["day"], "items": x["items"]} for x in out if x["items"]]}

class Ask(BaseModel):
    question: str

@app.post("/api/explain")
def explain(a: Ask, uid=Depends(user)):
    hits = retrieve(uid, a.question, ["notes", "syllabus"], 5)
    if not hits:
        return {"answer": "I couldn't find this in your uploaded material, so I won't guess. "
                          "Try different words, or upload notes that cover it.", "sources": []}
    ctx = "\n\n".join(f'[{i + 1}] ({h["source"]}) {h["text"]}' for i, h in enumerate(hits))
    answer = chat("Explain using ONLY the numbered excerpts. Cite like [1]. If they don't cover the question, "
                  "say the material doesn't cover it. Never use outside knowledge.",
                  f"Excerpts:\n{ctx}\n\nQuestion: {a.question}", 900)
    return {"answer": answer, "sources": [{"n": i + 1, "source": h["source"]} for i, h in enumerate(hits)]}

@app.get("/api/progress")
def progress(uid=Depends(user)):
    out = []
    for a in q("select * from attempts where user_id=? and total>0 order by id", (uid,)):
        rows = q("select t.name n, avg(x.correct) p from answers x join topics t on t.id=x.topic_id "
                 "where x.attempt_id=? group by t.name", (a["id"],))
        out.append({"id": a["id"], "created": str(a["created"]), "score": a["score"], "total": a["total"],
                    "topics": {r["n"]: round(float(r["p"]) * 100) for r in rows}})
    return {"attempts": out}

try:
    init()
except Exception as e:
    print("Database init failed:", e)