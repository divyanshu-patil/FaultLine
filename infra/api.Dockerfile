FROM python:3.14-slim
WORKDIR /app/apps/api
COPY apps/api/pyproject.toml ./
RUN pip install --no-cache-dir .
COPY apps/api/app ./app
COPY apps/api/run.py ./
COPY packages/db/migrations /app/packages/db/migrations
EXPOSE 4000
CMD ["python", "run.py"]
