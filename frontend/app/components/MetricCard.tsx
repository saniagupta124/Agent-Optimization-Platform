"use client";

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
}

export default function MetricCard({ title, value, subtitle }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <p className="text-sm font-medium text-gray-400">{title}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
        {value}
      </p>
      {subtitle && (
        <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
      )}
    </div>
  );
}
