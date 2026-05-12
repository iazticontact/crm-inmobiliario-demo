// Hand-crafted PDF 1.4 generator — no external dependencies.
// Produces valid A4 PDFs with Helvetica, text wrap, multi-page, and footer.

const A4_W = 595
const A4_H = 842
const ML = 50    // margin left
const MR = 50    // margin right
const MT = 65    // margin top
const MB = 55    // margin bottom
const TW = A4_W - ML - MR  // usable text width = 495
const FOOTER_RESERVE = 28  // pts reserved at bottom for footer

// Approximate Helvetica glyph widths per 1000 units (subset)
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

function glyphW(code: number, fontSize: number): number {
  return ((GLYPH_WIDTHS[code] ?? 556) / 1000) * fontSize
}

function measureStr(s: string, fontSize: number): number {
  let w = 0
  for (let i = 0; i < s.length; i++) w += glyphW(s.charCodeAt(i), fontSize)
  return w
}

function wrapText(text: string, fontSize: number, maxW: number): string[] {
  if (!text) return ['']
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word
    if (measureStr(test, fontSize) <= maxW) {
      cur = test
    } else {
      if (cur) lines.push(cur)
      if (measureStr(word, fontSize) > maxW) {
        let rem = word
        while (measureStr(rem, fontSize) > maxW) {
          let cut = rem.length - 1
          while (cut > 1 && measureStr(rem.slice(0, cut), fontSize) > maxW) cut--
          lines.push(rem.slice(0, cut))
          rem = rem.slice(cut)
        }
        cur = rem
      } else {
        cur = word
      }
    }
  }
  if (cur !== undefined) lines.push(cur)
  return lines.length ? lines : ['']
}

// Replace non-latin chars with safe ASCII equivalents for Helvetica/WinAnsi
function sanitize(s: string): string {
  return s
    .replace(/[─━═╌╍]/g, '-')
    .replace(/[→←↑↓⇒⇐]/g, '>')
    .replace(/[""«»]/g, '"')
    .replace(/[''`]/g, "'")
    .replace(/[…]/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/[^\x00-\xFF]/g, '?')
}

function pdfEscape(s: string): string {
  const safe = sanitize(s)
  let out = ''
  for (let i = 0; i < safe.length; i++) {
    const c = safe[i]
    if (c === '(') out += '\\('
    else if (c === ')') out += '\\)'
    else if (c === '\\') out += '\\\\'
    else out += c
  }
  return `(${out})`
}

interface Block {
  text: string
  fontSize: number
  bold: boolean
  spaceBefore: number
}

interface RenderedLine {
  text: string
  y: number
  fontSize: number
  bold: boolean
}

function paginate(blocks: Block[]): RenderedLine[][] {
  const pages: RenderedLine[][] = []
  let page: RenderedLine[] = []
  let y = A4_H - MT

  const minY = MB + FOOTER_RESERVE + 4

  for (const block of blocks) {
    const lh = block.fontSize * 1.45
    const wrapped = wrapText(block.text, block.fontSize, TW)
    for (let wi = 0; wi < wrapped.length; wi++) {
      const extra = wi === 0 ? block.spaceBefore : 0
      const needed = extra + lh
      if (y - needed < minY && page.length > 0) {
        pages.push(page)
        page = []
        y = A4_H - MT
      }
      y -= extra
      y -= lh
      page.push({ text: wrapped[wi], y, fontSize: block.fontSize, bold: block.bold })
    }
  }
  if (page.length > 0 || pages.length === 0) pages.push(page)
  return pages
}

function buildStream(page: RenderedLine[], footerLeft: string, pageNum: number, total: number): Uint8Array {
  const enc = new TextEncoder()
  const lines: string[] = ['BT']
  for (const ln of page) {
    lines.push(`${ln.bold ? '/F2' : '/F1'} ${ln.fontSize} Tf`)
    lines.push(`1 0 0 1 ${ML} ${ln.y.toFixed(2)} Tm`)
    lines.push(`${pdfEscape(ln.text)} Tj`)
  }
  const fy = (MB + 8).toFixed(2)
  const label = `Pagina ${pageNum} de ${total}`
  const labelW = measureStr(label, 8)
  const labelX = (A4_W - MR - labelW).toFixed(2)
  lines.push(`/F1 8 Tf`)
  lines.push(`1 0 0 1 ${ML} ${fy} Tm`)
  lines.push(`${pdfEscape(footerLeft.length > 70 ? footerLeft.slice(0, 67) + '...' : footerLeft)} Tj`)
  lines.push(`1 0 0 1 ${labelX} ${fy} Tm`)
  lines.push(`${pdfEscape(label)} Tj`)
  lines.push('ET')
  return enc.encode(lines.join('\n') + '\n')
}

export interface SimplePdfOptions {
  title: string
  subtitle?: string
  lines: string[]
}

export function generateSimplePdfBytes(opts: SimplePdfOptions): Uint8Array {
  const { title, subtitle, lines } = opts

  const blocks: Block[] = []
  blocks.push({ text: title, fontSize: 17, bold: true, spaceBefore: 0 })
  if (subtitle) blocks.push({ text: subtitle, fontSize: 10, bold: false, spaceBefore: 5 })
  blocks.push({ text: '', fontSize: 10, bold: false, spaceBefore: 6 })

  for (const raw of lines) {
    const t = raw.trim()
    // Section headers: "1. TITLE" or all-caps short lines (≤60 chars, no leading dash)
    const isSection = /^\d+\.\s/.test(t) && t.length < 80
    blocks.push({ text: raw, fontSize: 10, bold: isSection, spaceBefore: isSection && t ? 7 : 0 })
  }

  const pages = paginate(blocks)
  const totalPages = pages.length

  // Object layout:
  //  1 Catalog, 2 Pages dict,
  //  3..(2+P) Page objects,
  //  (3+P)..(2+2P) Content streams,
  //  (3+2P) Font Helvetica,
  //  (4+2P) Font Helvetica-Bold
  const P = totalPages
  const fontRegN = 3 + 2 * P
  const fontBoldN = 4 + 2 * P
  const totalObjs = fontBoldN + 1

  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const objOff: number[] = new Array(totalObjs).fill(0)
  let off = 0

  function put(s: string) {
    const b = enc.encode(s)
    chunks.push(b)
    off += b.length
  }
  function putB(b: Uint8Array) { chunks.push(b); off += b.length }
  function obj(n: number) { objOff[n] = off; put(`${n} 0 obj\n`) }
  function endobj() { put('endobj\n') }

  put('%PDF-1.4\n')
  // Binary-content hint (raw bytes, not TextEncoded)
  putB(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]))

  obj(1); put(`<< /Type /Catalog /Pages 2 0 R >>\n`); endobj()

  const kids = Array.from({ length: P }, (_, i) => `${3 + i} 0 R`).join(' ')
  obj(2); put(`<< /Type /Pages /Kids [${kids}] /Count ${P} >>\n`); endobj()

  // Pre-build streams to know their byte lengths
  const streamBufs = pages.map((pg, i) => buildStream(pg, title, i + 1, totalPages))

  // Page objects
  for (let i = 0; i < P; i++) {
    obj(3 + i)
    put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] `)
    put(`/Contents ${3 + P + i} 0 R `)
    put(`/Resources << /Font << /F1 ${fontRegN} 0 R /F2 ${fontBoldN} 0 R >> >> >>\n`)
    endobj()
  }

  // Content streams
  for (let i = 0; i < P; i++) {
    const sb = streamBufs[i]
    obj(3 + P + i)
    put(`<< /Length ${sb.length} >>\nstream\n`)
    putB(sb)
    put('\nendstream\n')
    endobj()
  }

  // Fonts (standard Type1 — no embedding needed)
  obj(fontRegN)
  put(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n`)
  endobj()
  obj(fontBoldN)
  put(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n`)
  endobj()

  // Cross-reference table (each entry exactly 20 bytes: offset[10] SP gen[5] SP kw CR LF)
  const xrefOff = off
  put(`xref\n0 ${totalObjs}\n`)
  put(`0000000000 65535 f\r\n`)
  for (let i = 1; i < totalObjs; i++) {
    put(`${String(objOff[i]).padStart(10, '0')} 00000 n\r\n`)
  }

  put(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`)

  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) { out.set(c, pos); pos += c.length }
  return out
}

export function generateReportPdfBytes(title: string, reportText: string): Uint8Array {
  return generateSimplePdfBytes({ title, lines: reportText.split('\n') })
}

export function generateInvoicePdfBytes(title: string, invoiceText: string): Uint8Array {
  return generateSimplePdfBytes({ title, lines: invoiceText.split('\n') })
}
