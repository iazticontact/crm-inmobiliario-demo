export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const parts = [
      record.step ? `step=${String(record.step)}` : '',
      record.message || record.error,
      record.code ? `code=${String(record.code)}` : '',
      record.details,
      record.hint ? `hint=${String(record.hint)}` : '',
    ].filter(Boolean).map(String)
    if (parts.length) return parts.join(' - ')

    try {
      return JSON.stringify(record)
    } catch {
      return Object.prototype.toString.call(error)
    }
  }
  return String(error || 'Error desconocido')
}

export function toError(error: unknown, fallback = 'Error desconocido') {
  const message = getErrorMessage(error)
  return new Error(message || fallback)
}
