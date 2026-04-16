"use client";

import Link from "next/link";
import { useState } from "react";

export default function TopBar() {
  const [search, setSearch] = useState("");

  return (
    <div
      className="flex h-[60px] shrink-0 items-center gap-4 px-6"
      style={{ background: "#1B1B1D", borderBottom: "1px solid #2A2A2D" }}
    >
      {/* Search */}
      <div
        className="flex flex-1 max-w-[400px] items-center rounded-xl overflow-hidden"
        style={{ background: "#262628", border: "1px solid #333336" }}
      >
        <span
          className="flex h-9 w-10 shrink-0 items-center justify-center rounded-l-xl"
          style={{ background: "#1BA86F" }}
        >
          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </span>
        <input
          type="text"
          placeholder="Search here..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent px-3 py-2 text-sm outline-none"
          style={{ color: "#ffffff", fontFamily: "'Clash Display', sans-serif" }}
        />
      </div>

      <div className="flex-1" />

      {/* Add agent */}
      <Link
        href="/agents/new"
        className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90"
        style={{
          background: "#E8A020",
          color: "#1B1B1D",
          fontFamily: "'Clash Display', sans-serif",
        }}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add agent
      </Link>
    </div>
  );
}
