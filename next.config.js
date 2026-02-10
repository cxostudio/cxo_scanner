/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Optimize for Vercel serverless
  experimental: {
    // Increase memory for API routes that use Puppeteer
    serverComponentsExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  },
  onDemandEntries: {
    maxInactiveAge: 50 * 1000,
    pagesBufferLength: 2,
  },
};

module.exports = nextConfig;
