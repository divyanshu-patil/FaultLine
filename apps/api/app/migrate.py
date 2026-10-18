"""Run DB migrations as a Render pre-deploy step: python -m app.migrate."""
import pathlib

import psycopg
from dotenv import load_dotenv

from .config import load_config


def main() -> None:
    load_dotenv()
    url = load_config().database_url
    sql = (pathlib.Path(__file__).resolve().parents[3] / "packages/db/migrations/001_init.sql").read_text()
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())")
        done = {r[0] for r in conn.execute("select name from schema_migrations").fetchall()}
        if "001_init.sql" in done:
            print("schema up to date")
            return
        conn.execute(sql)
        conn.execute("insert into schema_migrations (name) values ('001_init.sql')")
        print("applied 001_init.sql")


if __name__ == "__main__":
    main()
