"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { getOutliers, OutlierRecord } from "../lib/api";

export default function OutliersTable() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  const [data, setData] = useState<OutlierRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getOutliers(token)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-gray-500">Loading outliers...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-red-900 bg-gray-900">
        <p className="text-red-400">Failed to load data: {error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-gray-500">No outlier data yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-800 text-gray-400">
          <tr>
            <th className="px-4 py-3 font-medium">Timestamp</th>
            <th className="px-4 py-3 font-medium">Agent</th>
            <th className="px-4 py-3 font-medium">Customer</th>
            <th className="px-4 py-3 font-medium">Provider</th>
            <th className="px-4 py-3 font-medium">Model</th>
            <th className="px-4 py-3 font-medium text-right">Tokens</th>
            <th className="px-4 py-3 font-medium text-right">Cost</th>
            <th className="px-4 py-3 font-medium text-right">Latency</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {data.map((row) => (
            <tr key={row.id} className="hover:bg-gray-800/50">
              <td className="whitespace-nowrap px-4 py-3 text-gray-300">
                {new Date(row.timestamp).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-gray-300">{row.agent_id}</td>
              <td className="px-4 py-3 text-gray-300">{row.customer_id}</td>
              <td className="px-4 py-3 text-gray-300">{row.provider}</td>
              <td className="px-4 py-3 text-gray-300">{row.model}</td>
              <td className="px-4 py-3 text-right text-gray-300">
                {row.total_tokens.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right font-medium text-white">
                ${row.cost_usd.toFixed(4)}
              </td>
              <td className="px-4 py-3 text-right text-gray-300">
                {(row.latency_ms / 1000).toFixed(2)}s
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
