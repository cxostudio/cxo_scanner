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

  // The scan lives on the main site: cxo.studio/scan/* is rewritten (cxo-studio vercel.json)
  // to this project, so every route here sits under /scan (pages, /scan/_next assets,
  // /scan/api). On cxo.studio itself, /scan is the website's landing page; the app owns
  // /scan/run (scan in progress) and /scan/results.
  // Long calls (/api/scan can run up to 300s) skip the cxo.studio proxy, which gives up
  // after 120s, and go straight to this project: see lib/base.ts.
  basePath: "/scan",

  async redirects() {
    return [
      // old links and the scanner's own home: the questions now live on cxo.studio/start,
      // a direct link with ?url&email still starts the scan
      { source: "/", destination: "/scan/run", basePath: false, permanent: false },
      { source: "/", destination: "/run", permanent: false },
      { source: "/scanner", destination: "/results", permanent: false },
    ];
  },

  // Client portal: a single static page (public/portal/index.html) that calls /api/*.
  // On portal.cxo.studio the paths carry no /scan prefix; that mapping lives in vercel.json
  // (Next only allows rewrites outside the base path to external URLs).
  async rewrites() {
    return [
      { source: "/portal", destination: "/portal/index.html" },
      { source: "/portal/:path((?!index\\.html$).*)", destination: "/portal/index.html" },
    ];
  },
};

module.exports = nextConfig;
