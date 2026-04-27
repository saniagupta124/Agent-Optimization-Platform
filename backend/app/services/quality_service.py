"""Quality evaluation service — latency, schema conformance, faithfulness proxy, error rate, truncation."""

from datetime import datetime, timedelta
from statistics import mean, stdev
from sqlalchemy.orm import Session
from app.db.models import Request


def _p95(vals: list) -> float | None:
    if len(vals) < 5:
        return None
    idx = int(len(vals) * 0.95)
    return float(vals[min(idx, len(vals) - 1)])


def compute_structure_conformance(db: Session, agent_id: str, days: int = 30) -> float | None:
    """% valid among explicitly measured requests. NULL = not measured (excluded)."""
    try:
        cutoff = datetime.utcnow() - timedelta(days=days)
        valid = db.query(Request).filter(Request.agent_id == agent_id, Request.timestamp >= cutoff, Request.structure_valid == True).count()
        invalid = db.query(Request).filter(Request.agent_id == agent_id, Request.timestamp >= cutoff, Request.structure_valid == False).count()
        measured = valid + invalid
        if measured == 0:
            return None
        return round(valid / measured * 100, 2)
    except Exception:
        return None


def compute_error_rate(db: Session, agent_id: str, days: int = 30) -> float | None:
    """% of requests that errored."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    total = db.query(Request).filter(Request.agent_id == agent_id, Request.timestamp >= cutoff).count()
    if total < 5:
        return None
    errors = db.query(Request).filter(Request.agent_id == agent_id, Request.timestamp >= cutoff, Request.status == "error").count()
    return round(errors / total * 100, 1)


def compute_truncation_rate(db: Session, agent_id: str, days: int = 30) -> float | None:
    """% of successful responses that appear truncated (hit token limit)."""
    from app.db.models import Agent
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    max_tokens = getattr(agent, "max_tokens", None) if agent else None
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = db.query(Request.completion_tokens).filter(Request.agent_id == agent_id, Request.timestamp >= cutoff, Request.status == "success").all()
    completions = [r.completion_tokens for r in rows if r.completion_tokens and r.completion_tokens > 0]
    if len(completions) < 5:
        return None
    if max_tokens:
        truncated = sum(1 for c in completions if c >= max_tokens * 0.95)
    else:
        max_seen = max(completions)
        if max_seen < 50:
            return None
        threshold = max_seen * 0.95
        truncated = sum(1 for c in completions if c >= threshold)
        if truncated < 3:
            return None
    return round(truncated / len(completions) * 100, 1)


def compute_faithfulness_proxy(db: Session, agent_id: str, days: int = 30) -> float | None:
    """Completion token consistency within prompt-size buckets. 0-100 (100=perfectly consistent)."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = db.query(Request.prompt_tokens, Request.completion_tokens).filter(
        Request.agent_id == agent_id, Request.timestamp >= cutoff, Request.completion_tokens > 0, Request.status == "success"
    ).all()
    if len(rows) < 20:
        return None
    buckets: dict[int, list[int]] = {}
    for r in rows:
        bucket = round(r.prompt_tokens / 100) * 100
        buckets.setdefault(bucket, []).append(r.completion_tokens)
    valid_buckets = [(k, v) for k, v in buckets.items() if len(v) >= 5]
    if not valid_buckets:
        return None
    cvs = []
    for _, completions in valid_buckets:
        avg = mean(completions)
        if avg == 0:
            continue
        sd = stdev(completions) if len(completions) > 1 else 0
        cvs.append(sd / avg)
    if not cvs:
        return None
    return max(0.0, round((1 - min(sum(cvs) / len(cvs), 1.0)) * 100, 1))


def compute_latency_stability(db: Session, agent_id: str, days: int = 30) -> float | None:
    """Latency stability 0-100 (100=perfectly stable). Uses CV of latency."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = db.query(Request.latency_ms).filter(Request.agent_id == agent_id, Request.timestamp >= cutoff, Request.latency_ms.isnot(None)).all()
    vals = [r.latency_ms for r in rows if r.latency_ms and r.latency_ms > 0]
    if len(vals) < 10:
        return None
    avg = mean(vals)
    if avg == 0:
        return None
    sd = stdev(vals) if len(vals) > 1 else 0
    return max(0.0, round((1 - min(sd / avg, 1.0)) * 100, 1))


def derive_confidence_rating(
    n: int,
    schema_conformance_pct: float | None = None,
    faithfulness_score: float | None = None,
    latency_stability: float | None = None,
    error_rate: float | None = None,
    truncation_rate: float | None = None,
) -> str:
    """4-tier confidence derived from sample size + all quality metrics."""
    if n < 20:
        return "insufficient"
    size_pts = 3 if n >= 500 else (2 if n >= 100 else 1)

    def _pts(val: float | None, good: float, ok: float, higher_is_better: bool = True) -> int:
        if val is None:
            return 1
        effective = val if higher_is_better else (100 - val)
        if effective >= good: return 2
        if effective >= ok: return 1
        return 0

    total = (size_pts + _pts(schema_conformance_pct, 95, 80)
             + _pts(faithfulness_score, 80, 60)
             + _pts(latency_stability, 70, 50)
             + _pts(error_rate, 95, 80, higher_is_better=False)
             + _pts(truncation_rate, 95, 80, higher_is_better=False))
    ratio = total / 13.0
    if ratio >= 0.75: return "high"
    if ratio >= 0.5: return "medium"
    return "low"


def get_latency_budget(db: Session, agent_id: str) -> float:
    try:
        from app.db.models import QualityBudget
        budget = db.query(QualityBudget).filter(QualityBudget.agent_id == agent_id).first()
        if budget is not None:
            return float(budget.max_latency_increase_ms)
    except Exception:
        pass
    return 200.0


def get_structure_threshold(db: Session, agent_id: str) -> float:
    try:
        from app.db.models import QualityBudget
        budget = db.query(QualityBudget).filter(QualityBudget.agent_id == agent_id).first()
        if budget is not None:
            return max(98.0, 100.0 - float(budget.max_structure_drop))
    except Exception:
        pass
    return 98.0


def compute_quality_signals(db: Session, agent_id: str, accepted_at: datetime | None = None) -> dict:
    """Current p95 latency + all quality metrics. accepted_at unused (kept for compat)."""
    now = datetime.utcnow()
    cur_rows = db.query(Request.latency_ms).filter(
        Request.agent_id == agent_id,
        Request.timestamp >= now - timedelta(days=30),
        Request.latency_ms.isnot(None),
    ).all()
    current_vals = sorted(r.latency_ms for r in cur_rows if r.latency_ms is not None)
    latency_p95_ms = _p95(current_vals)

    structure_conformance_pct = compute_structure_conformance(db, agent_id)
    faithfulness_score = compute_faithfulness_proxy(db, agent_id)
    latency_stability = compute_latency_stability(db, agent_id)
    error_rate = compute_error_rate(db, agent_id)
    truncation_rate = compute_truncation_rate(db, agent_id)

    quality_impact = "none"
    latency_budget = get_latency_budget(db, agent_id)
    structure_threshold = get_structure_threshold(db, agent_id)
    if error_rate is not None and error_rate > 10:
        quality_impact = "high"
    elif structure_conformance_pct is not None and structure_conformance_pct < structure_threshold:
        quality_impact = "high"
    elif (faithfulness_score is not None and faithfulness_score < 50) or (truncation_rate is not None and truncation_rate > 15):
        quality_impact = "medium"

    return {
        "latency_p95_ms": latency_p95_ms,
        "structure_conformance_pct": structure_conformance_pct,
        "faithfulness_score": faithfulness_score,
        "latency_stability": latency_stability,
        "error_rate": error_rate,
        "truncation_rate": truncation_rate,
        "judge_preference_pct": None,
        "quality_impact": quality_impact,
    }
