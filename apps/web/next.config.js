/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN || "http://localhost:4000";

const nextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
