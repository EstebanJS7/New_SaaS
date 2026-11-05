/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // DEC-093: the error-tracking SDK is loaded by Node at runtime, never bundled.
  serverExternalPackages: ["@sentry/node", "@newsaas/observability"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
};

export default nextConfig;
