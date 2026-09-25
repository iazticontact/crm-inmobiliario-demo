'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react'
import { Button } from '@/components/Button'

export default function SaasError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('[saas-error-boundary]', error)
  }, [error])

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="mx-auto flex min-h-[55vh] max-w-xl items-center justify-center px-4 py-12"
    >
      <div className="w-full rounded-2xl border border-amber-200/80 bg-white p-6 text-center shadow-sm shadow-amber-950/5 sm:p-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-100">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-gray-950">No hemos podido abrir esta sección</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500">
          Puede ser un problema temporal. Reintenta la carga y, si continúa, vuelve al centro operativo.
        </p>
        {error.digest && (
          <p className="mt-3 text-xs text-gray-400">Referencia: {error.digest}</p>
        )}
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Ir al dashboard
          </Link>
          <Button onClick={() => unstable_retry()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      </div>
    </section>
  )
}
