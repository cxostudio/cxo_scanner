/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "puppeteer",
      "puppeteer-core",
      "@sparticuz/chromium",
      "tesseract.js",
    ],
  },
  onDemandEntries: {
    maxInactiveAge: 50 * 1000,
    pagesBufferLength: 2,
  },

  // app.cxo.studio is the single app: free scan at "/", client portal at "/portal".
  // The old hostnames are attached to this same Vercel project and redirected here,
  // so existing links and client bookmarks keep working.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "portal.cxo.studio" }],
        destination: "https://app.cxo.studio/portal",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "audit.cxo.studio" }],
        destination: "https://app.cxo.studio/:path*",
        permanent: true,
      },
    ];
  },

  // The client portal is a single static page (public/portal/index.html) that talks
  // to the /api/hours, /api/timeline, /api/performance... routes in pages/api.
  async rewrites() {
    return [
      { source: "/portal", destination: "/portal/index.html" },
      { source: "/portal/:path((?!index\\.html$).*)", destination: "/portal/index.html" },
    ];
  },
};

module.exports = nextConfig;
