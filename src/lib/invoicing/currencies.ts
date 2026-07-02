// Divisas soportadas en Facturación (P36F). Se guarda el código ISO 4217. Formato de importes vía
// Intl.NumberFormat (formatInvoiceCurrency). EUR es la moneda base del CRM para el resumen financiero.

import type { Option } from '@/lib/geo-language-data'

export type Currency = { code: string; name: string; aliases: string[] }

export const CURRENCIES: Currency[] = [
  { code: 'EUR', name: 'Euro', aliases: ['euro', 'euros', '€', 'eur'] },
  { code: 'USD', name: 'Dólar estadounidense', aliases: ['dolar', 'dollar', 'usd', '$', 'usa'] },
  { code: 'GBP', name: 'Libra esterlina', aliases: ['libra', 'pound', 'gbp', '£', 'sterling'] },
  { code: 'CHF', name: 'Franco suizo', aliases: ['franco', 'swiss', 'chf', 'suiza'] },
  { code: 'MXN', name: 'Peso mexicano', aliases: ['peso mexicano', 'mexico', 'mxn'] },
  { code: 'COP', name: 'Peso colombiano', aliases: ['peso colombiano', 'colombia', 'cop'] },
  { code: 'ARS', name: 'Peso argentino', aliases: ['peso argentino', 'argentina', 'ars'] },
  { code: 'CLP', name: 'Peso chileno', aliases: ['peso chileno', 'chile', 'clp'] },
  { code: 'PEN', name: 'Sol peruano', aliases: ['sol', 'peru', 'pen'] },
  { code: 'MAD', name: 'Dírham marroquí', aliases: ['dirham', 'marruecos', 'mad'] },
  { code: 'BRL', name: 'Real brasileño', aliases: ['real', 'brasil', 'brl'] },
  { code: 'CAD', name: 'Dólar canadiense', aliases: ['dolar canadiense', 'canada', 'cad'] },
  { code: 'AED', name: 'Dírham (EAU)', aliases: ['dirham', 'emiratos', 'aed', 'dubai'] },
]

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code)

export const currencyOptions: Option[] = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} — ${c.name}`,
  aliases: [c.name.toLowerCase(), ...c.aliases],
}))

export function isValidCurrency(code: string | null | undefined): boolean {
  return !!code && CURRENCY_CODES.includes(code.toUpperCase())
}

export function currencyName(code: string): string {
  return CURRENCIES.find((c) => c.code === code.toUpperCase())?.name ?? code
}
