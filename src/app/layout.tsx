import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import { BRAND } from '@/lib/brand'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: BRAND.appName,
  description: BRAND.appDescription,
}

// Viewport móvil (P28C). `viewport-fit=cover` habilita las safe-area de iOS.
// NO se bloquea el zoom (sin maximumScale/userScalable): el auto-zoom de iOS se
// evita con font-size >= 16px en los campos (ver globals.css), preservando la
// accesibilidad (el usuario puede hacer pinch-zoom si lo necesita).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="h-full font-sans antialiased">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
