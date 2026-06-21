// Central branding source for the demo.
//
// Keep ALL user-visible product names, descriptions and support copy here so a
// future rebrand (or per-client customization) is a single-file change.
//
// This file is intentionally free of any legacy brand: no "NowLabs", "NowCRM",
// "Costa del Sol" or "Real Homes". Do NOT hardcode product names in UI
// components — import BRAND and reference these fields instead.

export const BRAND = {
  /** Visible product name — titles, sidebar, login, topbar fallback. */
  appName: 'CRM Inmobiliario',
  /** Short tagline / HTML meta description. */
  appDescription: 'CRM para inmobiliarias: clientes, operaciones, agenda y copiloto IA',
  /** Default workspace label shown before a real Supabase workspace resolves. */
  workspaceName: 'Demo Inmobiliaria',
  /** Who the user should contact for support — neutral, no brand. */
  supportName: 'equipo técnico',
  /** Visible name of the in-app AI assistant (chat, titles, timeline). */
  assistantName: 'Asistente IA',
  /** One-line description of the assistant (headers, empty states). */
  assistantDescription: 'Copiloto del CRM para tu inmobiliaria',
  /**
   * Optional "powered by" / signature line. Empty string = hidden.
   * Kept neutral on purpose (no commercial brand yet).
   */
  poweredBy: '',
} as const

export type Brand = typeof BRAND
