# apps/api — FaultLine product API (FastAPI)

Python FastAPI service. Sessions, targets, runs, findings, reports and the SSE run stream (docs/09 §1).
It shares the Postgres database with the TypeScript worker (schema owned by `packages/db`).

## Run

```bash
cd apps/api
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
# DATABASE_URL etc. come from the repo-root .env
python run.py            # serves on PORT (default 4000)
```

## Test

```bash
pip install -e ".[dev]"
pytest -q                # needs DATABASE_URL (or TEST_DATABASE_URL); each test uses its own schema
```
