"use client";

import "./traeco-dashboard.css";
import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="traeco-dashboard">
      <div className="tr-shell" id="tr-shell">
        <Sidebar />
        <div className="tr-main">
          <TopBar />
          <div className="tr-main-content">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
