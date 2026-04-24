"""Quality evaluation service — latency p95, structure conformance, confidence signals."""

from datetime import datetime, timedelta
from statistics import mean, stdev
from sqlalchemy.orm import Session
from app.db.models import Request


def compute_latency_p95(db: Session, agent_id: str, days: int = 30) -> float | None:
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
    return None


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


def compute_confidence_flags(db: Session, agent_id: str, recent_requests: list) -> list[str]:
    """
    Derive confidence flags from behavioral signals in the Request table.
    Returns a list of human-readable flag strings.
    """
    flags: list[str] = []
    now = datetime.utcnow()

    if not recent_requests:
        return flags

    # 1. Stale data — last request too long ago
    timestamps = sorted(r.timestamp for r in recent_requests if r.timestamp)
    if timestamps:
        days_since_last = (now - timestamps[-1]).days
        if days_since_last > 7:
            flags.append(f"stale data — last request {days_since_last}d ago")

    # 2. Error rate instability — compare current 7d vs prior 7-30d
    cutoff_7d = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)
    current_reqs = [r for r in recent_requests if r.timestamp and r.timestamp >= cutoff_7d]
    baseline_reqs = [r for r in recent_requests if r.timestamp and r.timestamp < cutoff_7d]

    if current_reqs and baseline_reqs:
        cur_err_rate = sum(1 for r in current_reqs if r.status == "error") / len(current_reqs)
        base_err_rate = sum(1 for r in baseline_reqs if r.status == "error") / len(baseline_reqs)
        if abs(cur_err_rate - base_err_rate) > 0.05:
            flags.append(f"error rate unstable ({base_err_rate*100:.1f}% → {cur_err_rate*100:.1f}%)")

    # 3. High latency variance — p95 >> p50
    latencies = [r.latency_ms for r in recent_requests if r.latency_ms is not None]
    if len(latencies) >= 10:
        sorted_lat = sorted(latencies)
        p50 = sorted_lat[len(sorted_lat) // 2]
        p95 = sorted_lat[int(len(sorted_lat) * 0.95)]
        if p50 > 0 and p95 > p50 * 3:
            flags.append(f"high latency variance (p50={p50}ms, p95={p95}ms)")

    # 4. Bursty traffic — coefficient of variation across 4 weekly buckets
    weeks: list[list] = [[], [], [], []]
    for r in recent_requests:
        if not r.timestamp:
            continue
        age_days = (now - r.timestamp).days
        week_idx = min(age_days // 7, 3)
        weeks[week_idx].append(r)
    week_counts = [len(w) for w in weeks]
    non_zero = [c for c in week_counts if c > 0]
    if len(non_zero) >= 2:
        avg = mean(non_zero)
        sd = stdev(non_zero) if len(non_zero) > 1 else 0
        cv = sd / avg if avg > 0 else 0
        if cv > 0.5:
            flags.append("bursty traffic pattern — weekly volume varies significantly")

    # 5. Multiple models in use — recommendation targets primary model only
    distinct_models = {r.model for r in recent_requests if r.model}
    if len(distinct_models) > 1:
        flags.append(f"{len(distinct_models)} models in use — recommendation targets primary only")

    return flags


def derive_confidence_rating(n: int, flags: list[str]) -> str:
    if n >= 500 and len(flags) == 0:
        return "high"
    if n >= 100 and len(flags) <= 2:
        return "medium"
    return "low"


def compute_quality_signals(db: Session, agent_id: str) -> dict:
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
