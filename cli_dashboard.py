"""
Traeco CLI Dashboard — live cost monitor for Mehek's Kalshi agent.

Polls GET /dashboard/mehek_agent and GET /recommendations/mehek_agent every 5s
and renders a live terminal dashboard using the `rich` library.

Usage:
    export TRAECO_API_KEY=tk_live_...
    export TRAECO_API_URL=http://localhost:8000   # default
    python cli_dashboard.py
"""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime

import httpx
from rich.columns import Columns
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

# ── Config ───────────────────────────────────────────────────────────────────

TRAECO_KEY = os.environ.get("TRAECO_API_KEY", "")
API_BASE = os.environ.get("TRAECO_API_URL", "http://localhost:8000").rstrip("/")
AGENT_NAME = "mehek_agent"
POLL_SECS = 5

console = Console()

# ── Data fetching ─────────────────────────────────────────────────────────────

def _headers() -> dict[str, str]:
    h: dict[str, str] = {}
    if TRAECO_KEY:
        h["X-Traeco-Key"] = TRAECO_KEY
    return h


def fetch_dashboard() -> dict | None:
    try:
        r = httpx.get(
            f"{API_BASE}/dashboard/{AGENT_NAME}",
            headers=_headers(),
            timeout=5,
        )
        if r.status_code == 200:
            return r.json()
        return None
    except Exception:
        return None


def fetch_recommendations() -> list[dict]:
    try:
        r = httpx.get(
            f"{API_BASE}/recommendations/{AGENT_NAME}",
            headers=_headers(),
            timeout=5,
        )
        if r.status_code == 200:
            return r.json()
        return []
    except Exception:
        return []


# ── Rendering ─────────────────────────────────────────────────────────────────

def _header_panel(data: dict | None) -> Panel:
    now = datetime.utcnow().strftime("%H:%M:%S UTC")
    if data is None:
        return Panel(
            Text("Waiting for agent data...", style="dim"),
            title=f"[bold green]Traeco[/bold green] · [cyan]{AGENT_NAME}[/cyan]",
            subtitle=now,
            border_style="green",
        )

    session_cost = data.get("session_cost_usd", 0)
    alltime_cost = data.get("alltime_cost_usd", 0)
    rpm = data.get("requests_per_minute", 0)
    session_reqs = data.get("session_request_count", 0)
    alltime_reqs = data.get("alltime_request_count", 0)

    kpis = (
        f"  [bold white]Session cost (1h)[/bold white]  [green]${session_cost:.4f}[/green]   "
        f"  [bold white]30d total[/bold white]  [green]${alltime_cost:.4f}[/green]   "
        f"  [bold white]Req/min[/bold white]  [cyan]{rpm:.1f}[/cyan]   "
        f"  [bold white]Requests[/bold white]  {session_reqs} session / {alltime_reqs} all-time"
    )
    return Panel(
        Text.from_markup(kpis),
        title=f"[bold green]Traeco[/bold green] · [cyan]{AGENT_NAME}[/cyan]",
        subtitle=now,
        border_style="green",
    )


def _span_table(data: dict | None) -> Panel:
    table = Table(show_header=True, header_style="bold cyan", box=None, padding=(0, 1))
    table.add_column("Span", style="bold")
    table.add_column("Cost (30d)", justify="right")
    table.add_column("Calls", justify="right")

    if data and data.get("by_span"):
        for row in data["by_span"]:
            cost_str = f"[green]${row['total_cost']:.4f}[/green]"
            table.add_row(row["span_name"], cost_str, str(row["request_count"]))

        # Highlight retry loops
        retry_loops = data.get("retry_loops", [])
        if retry_loops:
            warning = Text()
            for loop in retry_loops:
                warning.append(
                    f"\n  ⚠ {loop['span_name']} fired 3+ times in {loop['window_seconds']}s",
                    style="bold red",
                )
            return Panel(table, title="Cost by Span", border_style="cyan", subtitle=warning)
    else:
        table.add_row("[dim]no data yet[/dim]", "", "")

    return Panel(table, title="Cost by Span", border_style="cyan")


def _model_table(data: dict | None) -> Panel:
    table = Table(show_header=True, header_style="bold magenta", box=None, padding=(0, 1))
    table.add_column("Model", style="bold")
    table.add_column("Cost (30d)", justify="right")
    table.add_column("Calls", justify="right")

    if data and data.get("by_model"):
        for row in data["by_model"]:
            cost_str = f"[green]${row['total_cost']:.4f}[/green]"
            table.add_row(row["model"], cost_str, str(row["request_count"]))
    else:
        table.add_row("[dim]no data yet[/dim]", "", "")

    return Panel(table, title="Cost by Model", border_style="magenta")


def _rec_table(recs: list[dict]) -> Panel:
    table = Table(show_header=True, header_style="bold yellow", box=None, padding=(0, 1))
    table.add_column("Span", style="bold")
    table.add_column("Type")
    table.add_column("Save/mo", justify="right")
    table.add_column("Confidence", justify="right")
    table.add_column("Applied", justify="center")

    TYPE_SHORT = {
        "model_swap": "model-swap",
        "retry_loop": "retry-loop",
        "context_bloat": "ctx-bloat",
        "redundant_calls": "redundant",
        "model_overkill": "overkill",
    }

    if recs:
        for rec in recs[:8]:  # cap at 8 rows
            applied = "[green]✓[/green]" if rec.get("applied") else "[dim]–[/dim]"
            save_str = f"[green]${rec['savings_per_month']:.2f}[/green]"
            conf_str = f"{rec['confidence']}%"
            table.add_row(
                rec["span_name"],
                TYPE_SHORT.get(rec["rec_type"], rec["rec_type"]),
                save_str,
                conf_str,
                applied,
            )
    else:
        table.add_row("[dim]no recommendations yet[/dim]", "", "", "", "")

    total_savings = sum(
        r["savings_per_month"] for r in recs if not r.get("applied")
    )
    subtitle = f"[green]${total_savings:.2f}/mo[/green] potential savings"
    return Panel(table, title="Recommendations", border_style="yellow", subtitle=subtitle)


def render(data: dict | None, recs: list[dict]) -> Layout:
    layout = Layout()
    layout.split_column(
        Layout(_header_panel(data), name="header", size=5),
        Layout(name="body"),
    )
    layout["body"].split_row(
        Layout(name="left"),
        Layout(_rec_table(recs), name="right"),
    )
    layout["left"].split_column(
        Layout(_span_table(data), name="spans"),
        Layout(_model_table(data), name="models"),
    )
    return layout


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    if not TRAECO_KEY:
        console.print(
            "[yellow]Warning:[/yellow] TRAECO_API_KEY not set — "
            "requests to authenticated endpoints will fail.\n"
            "Set it with: [bold]export TRAECO_API_KEY=tk_live_...[/bold]\n"
        )

    console.print(f"[green]Traeco CLI Dashboard[/green] · polling [cyan]{API_BASE}[/cyan] every {POLL_SECS}s")
    console.print(f"Agent: [bold]{AGENT_NAME}[/bold]  |  Press Ctrl-C to exit\n")

    data = fetch_dashboard()
    recs = fetch_recommendations()

    with Live(render(data, recs), console=console, refresh_per_second=0.5, screen=True) as live:
        while True:
            time.sleep(POLL_SECS)
            data = fetch_dashboard()
            recs = fetch_recommendations()
            live.update(render(data, recs))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        console.print("\n[dim]Traeco dashboard stopped.[/dim]")
        sys.exit(0)
