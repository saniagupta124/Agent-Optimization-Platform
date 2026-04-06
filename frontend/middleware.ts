export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/",
    "/onboarding",
    "/agents/:path*",
    "/outliers/:path*",
    "/settings/:path*",
    "/team",
    "/team/:path*",
    "/recommendations",
    "/recommendations/:path*",
  ],
};
