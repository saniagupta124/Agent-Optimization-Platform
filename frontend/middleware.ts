export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/",
    "/agents/:path*",
    "/outliers/:path*",
    "/settings/:path*",
  ],
};
