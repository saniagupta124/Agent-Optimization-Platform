"use client";

import Link from "next/link";
import { useState } from "react";

export default function TopBar() {
  const [search, setSearch] = useState("");
  const [range, setRange] = useState("30d");

  return (
    <div className="tr-topbar">
      <div className="tr-search">
        <span className="tr-search-chip">
          <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </span>
        <input
          className="tr-search-input"
          placeholder="Search here…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="tr-topbar-right">
        <div className="tr-toggle">
          {(["7d","14d","30d"] as const).map((r) => (
            <button
              key={r}
              className={`tr-seg${range === r ? " active" : ""}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <Link href="/agents/new" className="tr-btn tr-btn-primary">
          <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add agent
        </Link>
      </div>
    </div>
  );
}
