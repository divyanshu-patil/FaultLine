"""Local entry point: `python run.py` (reads .env, serves on PORT)."""
import os

import uvicorn
from dotenv import load_dotenv

if __name__ == "__main__":
    load_dotenv()
    from app.main import app_factory

    uvicorn.run(app_factory(), host="0.0.0.0", port=int(os.environ.get("PORT", "4000")), log_level="warning")
