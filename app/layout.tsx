import type { Metadata, Viewport } from 'next'
import { ReactNode } from 'react'
import './globals.css'
import 'react-toastify/dist/ReactToastify.css'
import { ToastContainer } from 'react-toastify'

export const metadata: Metadata = {
  title: 'Free conversion scan | CXO studio',
  description: 'Scan your product page against 40 conversion checkpoints and see what costs you sales.',
  // without this the browser asks cxo.studio for /favicon.ico and gets the Astro site's default icon
  // (the scanner lives under /scan, and metadata icon links don't get the basePath added)
  icons: { icon: [{ url: '/scan/favicon.png', type: 'image/png', sizes: '256x256' }], apple: '/scan/favicon.png' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="en" className="overflow-x-clip">
      <body className="overflow-x-clip min-w-0 w-full">
        <div className="cxo-wash" aria-hidden="true" />
        {children}
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="light"
        />
      </body>
    </html>
  )
}