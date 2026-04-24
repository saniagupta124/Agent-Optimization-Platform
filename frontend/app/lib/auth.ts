import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

async function refreshAccessToken(token: any): Promise<any> {
  try {
    const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: token.refreshToken }),
    });
    if (!res.ok) return { ...token, error: "RefreshAccessTokenError" };
    const data = await res.json();
    return {
      ...token,
      accessToken: data.access_token,
      accessTokenExpires: Date.now() + ACCESS_TOKEN_TTL_MS,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const res = await fetch(`${BACKEND_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });

        if (!res.ok) return null;

        const data = await res.json();
        return {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          organizationName: data.user.organization_name,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.accessTokenExpires = Date.now() + ACCESS_TOKEN_TTL_MS;
        token.userId = user.id;
        token.organizationName = (user as any).organizationName;
        return token;
      }
      // Determine expiry: use stored value or decode the JWT directly (handles legacy sessions)
      const expires =
        (token.accessTokenExpires as number) ||
        jwtExpiry(token.accessToken as string);
      if (Date.now() < expires) return token;
      // Token expired — try to refresh
      if (!token.refreshToken) {
        return { ...token, error: "SessionExpiredError" };
      }
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      (session as any).userId = token.userId;
      (session as any).organizationName = token.organizationName;
      (session as any).error = token.error;
      if (session.user) {
        (session.user as any).id = token.userId;
      }
      return session;
    },
  },
  pages: {
    signIn: "/signin",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET || "dev-secret-change-in-production",
};
