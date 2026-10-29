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

  // Host redirects (portal.cxo.studio / audit.cxo.studio -> the final app domain) are
  // intentionally not set yet: app.cxo.studio still serves the old checklist project.
  // Add them here once the final domain for this app is attached to this project.

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
