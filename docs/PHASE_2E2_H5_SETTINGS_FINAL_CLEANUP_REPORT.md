# Phase 2E-2 H5 — Settings final cleanup

> **Fecha:** 2026-06-15 · **Base:** `dd31b48` · Solo UI en `settings/page.tsx`
> (gating por `SHOW_INTERNAL_TECH`). **No se tocó backend, schema, RLS, rutas,
> Auth, ni `.env.local`.** Cierra los pendientes menores de H4.

## 1. Objetivo
Dejar **Settings totalmente honesto para el cliente normal** antes del smoke real:
sin módulos dormidos visibles.

## 2. Qué quedaba pendiente (de H4)
1. Tarjeta **WhatsApp** completa (estaba suavizada pero visible).
2. Toggles de notificación dormidos: **Facturas vencidas** y **Conversaciones
   urgentes**.

## 3. Qué se ocultó (gateado por `NOWLABS_INTERNAL`, reversible, sin borrar código)
- **Tarjeta WhatsApp** (`settings/page.tsx`, SectionCard ~1375–1564): envuelta en
  `{SHOW_INTERNAL_TECH && (…)}`. Para el cliente ya no aparece WhatsApp como
  módulo configurable; el operador interno la sigue viendo.
- **Notificaciones** (mapa de `notifDefaults`): se filtran **`Facturas vencidas`**
  (`invoices`) y **`Conversaciones urgentes`** (`urgent`) para el cliente
  (`!['invoices','urgent'].includes(n.key)`), visibles solo en internal.

> Nota: la tarjeta **Instagram Business** (siguiente sibling) ya estaba gateada en
> internal desde antes; sigue igual.

## 4. Qué quedó visible (cliente normal)
- Vertical del workspace · Mi cuenta · Plataforma IA (gestionada por equipo
  técnico) · Asistente IA · Mantenimiento incluido.
- Notificaciones genéricas reales: **Nuevos leads** y **Resumen diario IA**, con
  copy suavizado para no prometer canales/facturación inexistentes:
  - leads: "Cuando se registra un nuevo cliente o lead en el CRM".
  - dailyReport: "Briefing diario con tareas, citas y siguientes acciones".

## 5. Qué NO se tocó
Backend, Supabase helpers, RLS, `/api/*` (assistant/n8n/etc.), Auth, Storage,
schema/migraciones, `.env.local`, `.mcp.json`. Solo `settings/page.tsx` (UI).
Tampoco se borró código ni rutas: todo sigue tras el flag interno.

## 6. Demo / real preservados
Sin cambios de lógica demo/real. El gating es por `NEXT_PUBLIC_NOWLABS_INTERNAL`
(false para cliente), igual que el resto del producto. Demo sigue por botón;
login real limpia la clave demo.

## 7. Validaciones
`tsc --noEmit` ✅ · `eslint --max-warnings=0` ✅ · `next build` ✅ (46 rutas).

## 8. Siguiente paso OBLIGATORIO — smoke real
No hay más polish pendiente. Oier debe:
1. Parar el `next dev` y volver a arrancarlo (`npm run dev`).
2. Hard refresh (Ctrl+Shift+R).
3. Login real (usuario Auth con contraseña ≥8).
4. **Smoke navegador completo:** dashboard → ficha (crear/editar/mover/completar
   tarea/operación/expediente/evento, recargar y verificar persistencia) →
   asistente (READ + acciones preparar→confirmar) → demo. Pasar resultados +
   consola para certificar persistencia (counts Supabase).
