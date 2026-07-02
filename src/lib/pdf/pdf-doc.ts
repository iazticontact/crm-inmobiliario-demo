// Motor PDF vectorial mínimo SIN dependencias (P36B). Sustituye al generador de texto plano para poder
// dibujar facturas profesionales: texto con color/negrita/alineación, rectángulos y líneas (tablas,
// cajas de totales, cabecera), imagen JPEG (logo real de empresa) y **acentos correctos** (codificación
// WinAnsi/CP1252 byte a byte, sin destrozar á/é/í/ó/ú/ñ/€). Coordenadas en top-left (y hacia abajo).
//
// Determinista y server+browser-safe. La única parte async (cargar el logo y convertirlo a JPEG) vive
// fuera de aquí; este motor solo recibe bytes ya listos.

export type RGB = [number, number, number]

const A4_W = 595.28
const A4_H = 841.89

// Anchos AFM de Helvetica (por 1000) — subconjunto para medir/alinear.
const GLYPH_WIDTHS: Record<number, number> = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 222,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556,
  64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778,
  80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944,
  88: 667, 89: 667, 90: 611, 91: 278, 92: 278, 93: 278, 94: 469, 95: 556,
  97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556,
  104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556,
  118: 500, 119: 722, 120: 500, 121: 500, 122: 500,
}

// Para medir, plegamos acentos a su letra base (mismo ancho en Helvetica) y damos ancho a símbolos comunes.
function foldForWidth(ch: string): number {
  const code = ch.charCodeAt(0)
  if (GLYPH_WIDTHS[code] !== undefined) return GLYPH_WIDTHS[code]
  const base = ch.normalize('NFD').replace(/\p{M}/gu, '')
  const b = base.charCodeAt(0)
  if (GLYPH_WIDTHS[b] !== undefined) return GLYPH_WIDTHS[b]
  if (ch === '€') return 556
  if (ch === '·' || ch === '•') return 278
  if (ch === '–') return 556
  if (ch === '—') return 1000
  if (ch === 'º' || ch === 'ª') return 370
  if (ch === '“' || ch === '”' || ch === '«' || ch === '»') return 500
  return 556
}

export function measureText(s: string, fontSize: number): number {
  let w = 0
  for (const ch of s) w += (foldForWidth(ch) / 1000) * fontSize
  return w
}

// CP1252 (WinAnsi) para los caracteres > 0xFF que sí tienen glifo (comillas, guiones, €…).
const CP1252_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

// String → bytes WinAnsi. á/é/í/ó/ú/ñ/ü (≤0xFF) van directos; el resto por el mapa; lo desconocido → '?'.
function winAnsiBytes(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0x3f
    if (cp === 0x28) { out.push(0x5c, 0x28); continue } // (
    if (cp === 0x29) { out.push(0x5c, 0x29); continue } // )
    if (cp === 0x5c) { out.push(0x5c, 0x5c); continue } // backslash
    if (cp <= 0x7f) out.push(cp)
    else if (cp <= 0xff) out.push(cp)
    else if (CP1252_EXTRA[ch] !== undefined) out.push(CP1252_EXTRA[ch])
    else out.push(0x3f)
  }
  return out
}

type PageImg = { name: string; obj: number; jpeg: Uint8Array; w: number; h: number }

export class PdfDoc {
  readonly W: number
  readonly H: number
  private pages: { bytes: number[]; imgs: PageImg[] }[] = []
  private cur: { bytes: number[]; imgs: PageImg[] }
  private images: PageImg[] = []
  private imgSeq = 0

  constructor(size: [number, number] = [A4_W, A4_H]) {
    this.W = size[0]; this.H = size[1]
    this.cur = { bytes: [], imgs: [] }
    this.pages.push(this.cur)
  }

  addPage(): void {
    this.cur = { bytes: [], imgs: [] }
    this.pages.push(this.cur)
  }

  private op(s: string): void {
    const b = s + '\n'
    for (let i = 0; i < b.length; i++) this.cur.bytes.push(b.charCodeAt(i))
  }
  private raw(bytes: number[]): void {
    for (const b of bytes) this.cur.bytes.push(b)
  }

  private static fmt(n: number): string { return (Math.round(n * 1000) / 1000).toString() }

  text(s: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: RGB; align?: 'left' | 'right' | 'center'; maxWidth?: number } = {}): void {
    const size = opts.size ?? 10
    let str = s ?? ''
    if (opts.maxWidth && opts.maxWidth > 0) str = this.ellipsize(str, size, opts.maxWidth)
    const w = measureText(str, size)
    let tx = x
    if (opts.align === 'right') tx = x - w
    else if (opts.align === 'center') tx = x - w / 2
    const [r, g, b] = opts.color ?? [0.1, 0.12, 0.16]
    const py = this.H - y
    this.op(`${PdfDoc.fmt(r)} ${PdfDoc.fmt(g)} ${PdfDoc.fmt(b)} rg`)
    this.op('BT')
    this.op(`/F${opts.bold ? 2 : 1} ${size} Tf`)
    this.op(`1 0 0 1 ${PdfDoc.fmt(tx)} ${PdfDoc.fmt(py)} Tm`)
    this.raw([0x28, ...winAnsiBytes(str), 0x29, 0x20, 0x54, 0x6a, 0x0a]) // ( ... ) Tj
    this.op('ET')
  }

  // Corta con "…" para que un texto no se salga de maxWidth (nombres/direcciones largas).
  ellipsize(s: string, size: number, maxWidth: number): string {
    if (measureText(s, size) <= maxWidth) return s
    let cut = s
    while (cut.length > 1 && measureText(cut + '…', size) > maxWidth) cut = cut.slice(0, -1)
    return cut + '…'
  }

  // Reparte un texto en varias líneas dentro de maxWidth (para descripciones y notas).
  wrap(s: string, size: number, maxWidth: number): string[] {
    const words = (s ?? '').split(/\s+/).filter(Boolean)
    if (!words.length) return ['']
    const lines: string[] = []
    let cur = ''
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word
      if (measureText(test, size) <= maxWidth) cur = test
      else {
        if (cur) lines.push(cur)
        if (measureText(word, size) > maxWidth) cur = this.ellipsize(word, size, maxWidth)
        else cur = word
      }
    }
    if (cur) lines.push(cur)
    return lines.length ? lines : ['']
  }

  rect(x: number, y: number, w: number, h: number, opts: { fill?: RGB; stroke?: RGB; lineWidth?: number } = {}): void {
    const py = this.H - y - h
    if (opts.fill) {
      const [r, g, b] = opts.fill
      this.op(`${PdfDoc.fmt(r)} ${PdfDoc.fmt(g)} ${PdfDoc.fmt(b)} rg`)
      this.op(`${PdfDoc.fmt(x)} ${PdfDoc.fmt(py)} ${PdfDoc.fmt(w)} ${PdfDoc.fmt(h)} re f`)
    }
    if (opts.stroke) {
      const [r, g, b] = opts.stroke
      this.op(`${PdfDoc.fmt(opts.lineWidth ?? 0.6)} w`)
      this.op(`${PdfDoc.fmt(r)} ${PdfDoc.fmt(g)} ${PdfDoc.fmt(b)} RG`)
      this.op(`${PdfDoc.fmt(x)} ${PdfDoc.fmt(py)} ${PdfDoc.fmt(w)} ${PdfDoc.fmt(h)} re S`)
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, opts: { color?: RGB; lineWidth?: number } = {}): void {
    const [r, g, b] = opts.color ?? [0.85, 0.87, 0.9]
    this.op(`${PdfDoc.fmt(opts.lineWidth ?? 0.6)} w`)
    this.op(`${PdfDoc.fmt(r)} ${PdfDoc.fmt(g)} ${PdfDoc.fmt(b)} RG`)
    this.op(`${PdfDoc.fmt(x1)} ${PdfDoc.fmt(this.H - y1)} m ${PdfDoc.fmt(x2)} ${PdfDoc.fmt(this.H - y2)} l S`)
  }

  // Dibuja un JPEG (DeviceRGB, DCTDecode) manteniendo proporción dentro de la caja (boxW × boxH),
  // anclado arriba-izquierda por defecto. `nativeW/H` son los píxeles reales del JPEG.
  image(jpeg: Uint8Array, nativeW: number, nativeH: number, x: number, y: number, boxW: number, boxH: number): void {
    const scale = Math.min(boxW / nativeW, boxH / nativeH)
    const w = nativeW * scale
    const h = nativeH * scale
    const img: PageImg = { name: `Im${this.imgSeq++}`, obj: -1, jpeg, w: nativeW, h: nativeH }
    this.images.push(img); this.cur.imgs.push(img)
    const py = this.H - y - h
    this.op('q')
    this.op(`${PdfDoc.fmt(w)} 0 0 ${PdfDoc.fmt(h)} ${PdfDoc.fmt(x)} ${PdfDoc.fmt(py)} cm`)
    this.op(`/${img.name} Do`)
    this.op('Q')
  }

  bytes(): Uint8Array {
    const P = this.pages.length
    const fontRegN = 3 + 2 * P
    const fontBoldN = 4 + 2 * P
    let nextObj = 5 + 2 * P
    for (const img of this.images) { img.obj = nextObj++ }
    const totalObjs = nextObj

    const chunks: Uint8Array[] = []
    const objOff: number[] = new Array(totalObjs).fill(0)
    let off = 0
    const enc = new TextEncoder()
    const put = (s: string) => { const b = enc.encode(s); chunks.push(b); off += b.length }
    const putB = (b: Uint8Array) => { chunks.push(b); off += b.length }
    const obj = (n: number) => { objOff[n] = off; put(`${n} 0 obj\n`) }
    const endobj = () => put('endobj\n')

    put('%PDF-1.4\n')
    putB(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

    obj(1); put('<< /Type /Catalog /Pages 2 0 R >>\n'); endobj()
    const kids = Array.from({ length: P }, (_, i) => `${3 + i} 0 R`).join(' ')
    obj(2); put(`<< /Type /Pages /Kids [${kids}] /Count ${P} >>\n`); endobj()

    // Page objects
    for (let i = 0; i < P; i++) {
      obj(3 + i)
      put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] `)
      put(`/Contents ${3 + P + i} 0 R `)
      put(`/Resources << /Font << /F1 ${fontRegN} 0 R /F2 ${fontBoldN} 0 R >> `)
      const imgs = this.pages[i].imgs
      if (imgs.length) {
        put('/XObject << ')
        for (const im of imgs) put(`/${im.name} ${im.obj} 0 R `)
        put('>> ')
      }
      put('>> >>\n')
      endobj()
    }

    // Content streams
    for (let i = 0; i < P; i++) {
      const body = Uint8Array.from(this.pages[i].bytes)
      obj(3 + P + i)
      put(`<< /Length ${body.length} >>\nstream\n`)
      putB(body)
      put('\nendstream\n')
      endobj()
    }

    // Fonts (WinAnsi → acentos correctos)
    obj(fontRegN); put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n'); endobj()
    obj(fontBoldN); put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n'); endobj()

    // Image XObjects (JPEG / DCTDecode)
    for (const im of this.images) {
      obj(im.obj)
      put(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`)
      putB(im.jpeg)
      put('\nendstream\n')
      endobj()
    }

    const xrefOff = off
    put(`xref\n0 ${totalObjs}\n`)
    put('0000000000 65535 f\r\n')
    for (let i = 1; i < totalObjs; i++) put(`${String(objOff[i]).padStart(10, '0')} 00000 n\r\n`)
    put(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`)

    const total = chunks.reduce((s, c) => s + c.length, 0)
    const out = new Uint8Array(total)
    let pos = 0
    for (const c of chunks) { out.set(c, pos); pos += c.length }
    return out
  }
}
