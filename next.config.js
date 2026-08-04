/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "puppeteer",
    "puppeteer-core",
    "@sparticuz/chromium",
  ],
  onDemandEntries: {
    maxInactiveAge: 50 * 1000,
    pagesBufferLength: 2,
  },
};

module.exports = nextConfig;
