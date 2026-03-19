"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getByProvider, GroupedMetric } from "../lib/api";

const COLORS = ["#6366f1", "#22d3ee", "#f59e0b", "#ef4444", "#10b981", "#8b5cf6"];

export default function ProviderBarChart() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [data, setData] = useState<GroupedMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getByProvider(token)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-gray-500">Loading chart...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-red-900 bg-gray-900">
        <p className="text-red-400">Failed to load data: {error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-gray-500">No provider data yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <h3 className="mb-4 text-lg font-semibold text-white">Cost by Provider</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="group"
            stroke="#6b7280"
            tick={{ fill: "#9ca3af", fontSize: 12 }}
          />
          <YAxis
            stroke="#6b7280"
            tick={{ fill: "#9ca3af", fontSize: 12 }}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "8px",
              color: "#f3f4f6",
            }}
            formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]}
          />
          <Bar dataKey="total_cost" fill={COLORS[2]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
