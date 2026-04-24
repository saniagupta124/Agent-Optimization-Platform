"use client";

import { useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import "./traeco-dashboard.css";
import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = useSession();

  useEffect(() => {
    const handler = () => signOut({ callbackUrl: "/signin" });
    window.addEventListener("auth:unauthorized", handler);
    return () => window.removeEventListener("auth:unauthorized", handler);
  }, []);

  // Redirect if the jwt callback flagged the session as expired
  useEffect(() => {
    if ((session as any)?.error === "SessionExpiredError") {
      signOut({ callbackUrl: "/signin" });
    }
  }, [session]);

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
