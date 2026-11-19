# GapFinder AI

Finds what a student doesn't know. Upload a syllabus, notes and past papers, take a diagnostic quiz with citations,
get a gap report (weak, medium, strong) and a prioritized revision plan that updates after every retest.

**Stack:** React + Tailwind (Vite) · FastAPI · SQLAlchemy (SQLite locally, PostgreSQL on Vercel) ·
Groq (`openai/gpt-oss-120b`) for generation · Gemini embeddings (hosted API) + TF-IDF for retrieval

**Demo login:** `demo` / `demo123`

## Features
- Material upload (PDF or text) for syllabus, notes and past papers
- Topic map from the syllabus, with how often each topic appears in past papers
- Diagnostic quiz generated from the material, with a citation to the source section
- Answer checking that explains why each answer is right or wrong
- Gap report: weak, medium and strong topics with reasons
- Revision plan fitted to available days and hours, updated after each retest
- Explain-this-topic assistant that answers only from the uploaded material
- Progress dashboard across attempts
- Login with saved student data

## How retrieval and generation are kept separate
| Step | Retrieval and rules (code) | Generation (Groq, only on retrieved excerpts) |
|---|---|---|
| Topic map | Links past-paper questions to topics | Splits the syllabus into units and topics |
| Quiz | Picks topics, fetches the best-matching note sections | Writes questions and per-option explanations |
| Citations | Server maps a chunk id to the real file and section | Cannot invent a citation |
| Grading | Compares the chosen option with the stored answer | None |
| Gap report | Accuracy sets weak, medium or strong | Writes the topic diagnosis |
| Revision plan | Priority, minutes and day layout | Writes the summary and per-topic tips |
| Explain a topic | Fetches the top sections | Answers only from them, or says the material doesn't cover it |

Retrieval is hybrid: Gemini embeddings (meaning) blended with TF-IDF (exact words). Embeddings are stored in the
database and compared in Python, so no vector database is needed. If the Gemini key is missing, search falls back to TF-IDF.

## Project structure
```
api/index.py          Vercel entry point (exposes the FastAPI app)
backend/main.py       API: upload, retrieval, quiz, gap analysis, plan, explain, progress
backend/sample/       sample syllabus, notes and past paper
frontend/             React + Tailwind UI
vercel.json           Vercel build and routing
requirements.txt      Python dependencies
```

## Run locally
Get two free keys: Groq (console.groq.com/keys) and Gemini (aistudio.google.com/apikey).

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Mac/Linux: source venv/bin/activate
pip install -r requirements.txt
copy .env.example .env         # Mac/Linux: cp .env.example .env
```
Add both keys to `backend/.env`, then:
```bash
uvicorn main:app --reload --port 8000
```
In a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173 and log in. Restart uvicorn after any change to `.env`.

## Deploy on Vercel
1. Push this repo to GitHub.
2. On vercel.com choose Add New, then Project, and import the repo. Leave the root directory as it is.
3. Add the environment variables `GROQ_API_KEY` and `GEMINI_API_KEY`, then deploy.
4. Open the project's Storage tab, create a Neon Postgres database and connect it to the project. This adds `DATABASE_URL`.
5. Redeploy from the Deployments tab.

## Known limits
- Scanned PDFs need OCR first.
- Vercel limits an upload to about 4.5 MB.
- Free API tiers are rate-limited, so take one quiz at a time.
- `SIM_MIN` (default 0.5) sets how close a section must be to count as relevant.

## Future work
Teacher class view, parent progress view, spaced-repetition reminders, multi-subject support, LMS integration.