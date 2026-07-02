'use client'

// Convierte una URL de imagen (logo real de empresa, bucket público) a bytes JPEG + dimensiones, listos
// para incrustar en el PDF (DCTDecode) manteniendo proporción. Aplana la transparencia sobre blanco (los
// PDF DCTDecode no llevan alfa) y reescala para no inflar el PDF. Solo navegador; si algo falla (CORS,
// formato, SSR) devuelve null y el PDF usa el nombre de la empresa como fallback elegante.

export type JpegImage = { jpeg: Uint8Array; width: number; height: number }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  try {
    const bin = atob(dataUrl.slice(comma + 1))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch { return null }
}

export async function urlToJpegBytes(url: string | null | undefined, maxDim = 600): Promise<JpegImage | null> {
  if (!url || typeof document === 'undefined') return null
  try {
    const img = await loadImage(url)
    let w = img.naturalWidth || img.width
    let h = img.naturalHeight || img.height
    if (!w || !h) return null
    const scale = Math.min(1, maxDim / Math.max(w, h))
    w = Math.max(1, Math.round(w * scale))
    h = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const bytes = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92))
    if (!bytes || bytes.length < 4) return null
    return { jpeg: bytes, width: w, height: h }
  } catch {
    return null
  }
}
