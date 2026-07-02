'use client'

// Input numérico profesional para Facturación (P40). Corrige el bug de UX: con los inputs controlados a un
// número, al borrar el "0" se reescribía 0 y no se podía escribir con libertad. Aquí mantenemos un ESTADO
// LOCAL de texto durante la edición: se puede vaciar, escribir con coma o punto y, al perder el foco, se
// normaliza a número (vacío → 0 o `min`). Los cálculos reciben siempre un número (vacío = 0), sin NaN.
//
// type="text" + inputMode="decimal" → teclado numérico en móvil, coma/punto permitidos, y a 16px (clase
// heredada) para no provocar auto-zoom en iOS.

import { useEffect, useRef, useState } from 'react'
import { parseDecimal, isEditingDecimal, clampNumber, formatDecimal } from '@/lib/invoicing/decimal'

export function DecimalInput({
  value, onCommit, min, max, decimals = true, allowNegative = false,
  disabled, className, placeholder, ariaLabel, list,
}: {
  value: number
  onCommit: (n: number) => void
  min?: number
  max?: number
  decimals?: boolean
  allowNegative?: boolean
  disabled?: boolean
  className?: string
  placeholder?: string
  ariaLabel?: string
  list?: string
}) {
  const [text, setText] = useState(() => formatDecimal(value))
  const focused = useRef(false)

  // Sincroniza desde fuera (reset del formulario, presets de IVA/IRPF, carga de factura) solo cuando el
  // input NO está enfocado, para no interrumpir al usuario mientras escribe.
  useEffect(() => {
    if (!focused.current) setText(formatDecimal(value))
  }, [value])

  const clamp = (n: number) => clampNumber(n, { min, max, decimals })

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      list={list}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
      className={className}
      value={text}
      onFocus={() => { focused.current = true }}
      onChange={(e) => {
        const raw = e.target.value
        if (!isEditingDecimal(raw, allowNegative)) return // ignora caracteres no válidos
        setText(raw)
        const p = parseDecimal(raw)
        // Vacío temporal → los cálculos lo tratan como 0, pero el texto se queda vacío (se puede seguir escribiendo).
        onCommit(p == null ? 0 : clamp(p))
      }}
      onBlur={() => {
        focused.current = false
        const p = parseDecimal(text)
        const v = p == null ? clamp(min ?? 0) : clamp(p)
        setText(formatDecimal(v))
        onCommit(v)
      }}
    />
  )
}
