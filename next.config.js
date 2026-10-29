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

  // Domains (one Vercel project):
  //  - scan.cxo.studio   free conversion scan. Canonical host: set CANONICAL_HOST=scan.cxo.studio
  //                      in Vercel once that domain is attached.
  //  - portal.cxo.studio client portal: "/" (and "/<client>") serve the cockpit
  //  - audit.cxo.studio  old name: pages redirect to the canonical host when CANONICAL_HOST is set;
  //                      /api stays reachable on every host so in-flight forms never break
  async redirects() {
    const canonical = process.env.CANONICAL_HOST;
    if (!canonical) return [];
    return [
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "audit.cxo.studio" }],
        destination: `https://${canonical}/:path`,
        permanent: true,
      },
    ];
  },

  // The client portal is a single static page (public/portal/index.html) that talks
  // to the /api/hours, /api/timeline, /api/performance... routes in pages/api.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", has: [{ type: "host", value: "portal.cxo.studio" }], destination: "/portal/index.html" },
        { source: "/:client((?!api/|portal/|_next/).+)", has: [{ type: "host", value: "portal.cxo.studio" }], destination: "/portal/index.html" },
      ],
      afterFiles: [
        { source: "/portal", destination: "/portal/index.html" },
        { source: "/portal/:path((?!index\\.html$).*)", destination: "/portal/index.html" },
      ],
    };
  },
};

module.exports = nextConfig;
