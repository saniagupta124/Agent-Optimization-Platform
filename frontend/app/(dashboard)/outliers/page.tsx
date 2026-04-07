"use client";

import OutliersTable from "../../components/OutliersTable";

export default function OutliersPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Cost Outliers</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Top 20 most expensive requests by cost
        </p>
      </div>
      <OutliersTable />
    </div>
  );
}
