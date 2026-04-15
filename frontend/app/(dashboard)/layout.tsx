"use client";

import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#1A1A1E]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-[#1A1A1E]">
          {children}
        </main>
      </div>
    </div>
  );
}
