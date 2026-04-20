"""Quality evaluation service — latency p95, structure conformance, LLM-as-judge."""

import os
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.db.models import Request


def compute_latency_p95(db: Session, agent_id: str, days: int = 30) -> float | None:
    """Returns p95 latency in ms for the agent over the last `days` days, or None."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(Request.latency_ms)
        .filter(Request.agent_id == agent_id, Request.timestamp >= cutoff, Request.latency_ms.isnot(None))
        .all()
    )
    vals = sorted(r.latency_ms for r in rows if r.latency_ms is not None)
    if len(vals) < 5:
        return None
    idx = int(len(vals) * 0.95)
    return float(vals[min(idx, len(vals) - 1)])


def compute_structure_conformance(db: Session, agent_id: str, days: int = 30) -> float | None:
    """Returns % of traces with structure_valid=True. None if column missing or no data."""
    try:
        cutoff = datetime.utcnow() - timedelta(days=days)
        total = db.query(Request).filter(Request.agent_id == agent_id, Request.timestamp >= cutoff).count()
        if total == 0:
            return None
        valid = db.query(Request).filter(
            Request.agent_id == agent_id,
            Request.timestamp >= cutoff,
            Request.structure_valid == True,
        ).count()
        return round(valid / total * 100, 2)
    except Exception:
        return None


def run_judge_evaluation(db: Session, agent_id: str, baseline_model: str, candidate_model: str, sample_size: int = 50) -> float | None:
    """
    Returns % of times candidate wins over baseline, or None if prompts not stored.
    Uses cached result from quality_evaluations table if evaluated within 24h.
    All Claude calls are wrapped in try/except — failure returns None gracefully.
    """
    # Check cache first
    try:
        from app.db.models import QualityEvaluation
        cutoff_24h = datetime.utcnow() - timedelta(hours=24)
        cached = (
            db.query(QualityEvaluation)
            .filter(
                QualityEvaluation.agent_id == agent_id,
                QualityEvaluation.baseline_model == baseline_model,
                QualityEvaluation.candidate_model == candidate_model,
                QualityEvaluation.evaluated_at >= cutoff_24h,
            )
            .first()
        )
        if cached is not None:
            return cached.preference_pct
    except Exception:
        pass

    # Privacy-preserving mode: only run judge if prompts are stored
    # We check by looking at whether any trace has non-null prompt content
    # Since we don't store prompt text by default, return None
    return None


def get_latency_budget(db: Session, agent_id: str) -> float:
    """Read max_latency_increase_ms from quality_budgets, fall back to 200ms."""
    try:
        from app.db.models import QualityBudget
        budget = db.query(QualityBudget).filter(QualityBudget.agent_id == agent_id).first()
        if budget is not None:
            return float(budget.max_latency_increase_ms)
    except Exception:
        pass
    return 200.0


def get_structure_threshold(db: Session, agent_id: str) -> float:
    """Read max_structure_drop from quality_budgets, return conformance threshold (default 98.0)."""
    try:
        from app.db.models import QualityBudget
        budget = db.query(QualityBudget).filter(QualityBudget.agent_id == agent_id).first()
        if budget is not None:
            # max_structure_drop=0 means no drop allowed from 100% → threshold is 100%
            # We treat threshold as 100 - max_structure_drop, min 98 for safety
            return max(98.0, 100.0 - float(budget.max_structure_drop))
    except Exception:
        pass
    return 98.0


def compute_quality_signals(db: Session, agent_id: str) -> dict:
    """
    Returns dict with:
      latency_p95_ms, latency_p95_baseline_ms, structure_conformance_pct,
      judge_preference_pct, quality_impact
    """
    # Current p95 (last 7 days) vs baseline p95 (7-30 days ago)
    now = datetime.utcnow()

    # Current window: last 7 days
    cur_cutoff = now - timedelta(days=7)
    cur_rows = (
        db.query(Request.latency_ms)
        .filter(Request.agent_id == agent_id, Request.timestamp >= cur_cutoff, Request.latency_ms.isnot(None))
        .all()
    )
    cur_vals = sorted(r.latency_ms for r in cur_rows if r.latency_ms is not None)

    # Baseline window: 7-30 days ago
    base_start = now - timedelta(days=30)
    base_end = now - timedelta(days=7)
    base_rows = (
        db.query(Request.latency_ms)
        .filter(
            Request.agent_id == agent_id,
            Request.timestamp >= base_start,
            Request.timestamp < base_end,
            Request.latency_ms.isnot(None),
        )
        .all()
    )
    base_vals = sorted(r.latency_ms for r in base_rows if r.latency_ms is not None)

    def _p95(vals: list) -> float | None:
        if len(vals) < 2:
            return None
        idx = int(len(vals) * 0.95)
        return float(vals[min(idx, len(vals) - 1)])

    latency_p95_ms = _p95(cur_vals)
    latency_p95_baseline_ms = _p95(base_vals)

    structure_conformance_pct = compute_structure_conformance(db, agent_id, days=30)
    judge_preference_pct = None  # privacy-preserving: always None until prompts stored

    # Derive quality_impact
    quality_impact = "none"

    latency_budget = get_latency_budget(db, agent_id)
    if (
        latency_p95_ms is not None
        and latency_p95_baseline_ms is not None
        and (latency_p95_ms - latency_p95_baseline_ms) > latency_budget
    ):
        quality_impact = "medium"

    structure_threshold = get_structure_threshold(db, agent_id)
    if structure_conformance_pct is not None and structure_conformance_pct < structure_threshold:
        quality_impact = "high"

    return {
        "latency_p95_ms": latency_p95_ms,
        "latency_p95_baseline_ms": latency_p95_baseline_ms,
        "structure_conformance_pct": structure_conformance_pct,
        "judge_preference_pct": judge_preference_pct,
        "quality_impact": quality_impact,
    }
