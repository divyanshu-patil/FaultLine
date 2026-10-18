"""Request/response models. These mirror the shared zod contracts in @faultline/schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

AttackId = Literal["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]
BugId = Literal["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"]
RunMode = Literal["agent", "checklist"]


class CreateSessionBody(BaseModel):
    code: str = Field(min_length=1, max_length=200)


class BudgetBody(BaseModel):
    maxSteps: int | None = Field(default=None, ge=1, le=40)
    maxAttacks: int | None = Field(default=None, ge=1, le=16)
    maxPatchAttempts: int | None = Field(default=None, ge=0, le=3)
    maxModelCalls: int | None = Field(default=None, ge=1, le=80)
    maxSeconds: int | None = Field(default=None, ge=60, le=1800)


class CreateRunBody(BaseModel):
    targetId: str = Field(min_length=1, max_length=100)
    mode: RunMode
    attacks: list[AttackId] | None = Field(default=None, min_length=1, max_length=8)
    budget: BudgetBody | None = None


class CustomTargetBody(BaseModel):
    bugs: list[BugId] = Field(min_length=1, max_length=8)
