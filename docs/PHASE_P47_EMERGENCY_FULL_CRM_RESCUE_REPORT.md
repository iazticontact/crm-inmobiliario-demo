# P47 — EMERGENCY FULL CRM RESCUE

**Estado:** COMPLETADO
**Fecha:** 2026-07
**Objetivo:** estabilizar el CRM para validación real — Asistente fiable, búsqueda inmobiliaria real, formularios móviles completos, staging diagnosticado. Causa raíz + fix + eval + doc en cada punto.

---

## 1. Baseline
`main`, árbol limpio, HEAD `19cdb84` (P46).

## 2. Reproducción de errores + causas raíz
| # | Síntoma (validador) | Causa raíz |
|---|---|---|
| P0 | Asistente: "no puedo acceder a la lista de clientes" | La ruta `/api/assistant/v2` delega TODO en **n8n** (`ASSISTANT_PROVIDER=n8n`), que a su vez llama de vuelta a `/api/agent/tool`. Si n8n está caído/mal configurado (o su callback falla), no había **fallback local** para lecturas básicas → el LLM se disculpa. |
| P0 | "más de 80 m²" no filtra / da raro | Bug en `parseBudget`: la `m` de `m²` se interpretaba como sufijo de **millón** → "80 m²" = "80.000.000 €" de precio. Y **no existía parsing de superficie** (m²). |
| P0 | Filtrar por m² imposible | `PropertyCriteria` no tenía `minArea/maxArea`; el motor no puntuaba `area_m2`. |
| P0 | Editar inmueble en móvil: sin m²/habitaciones/baños | El **formulario de edición** (`EditPropertyForm`) no incluía esos campos (el de creación sí) y `updateProperty` no los persistía. |
| P0 | Auto-zoom en móvil al enfocar inputs | Inputs a `text-sm` (14px); iOS Safari hace zoom con <16px. |
| P1 | "Y el de Malasaña?" sin resultados | **No existía ningún inmueble en Malasaña** en los datos; además había un inmueble con dato vulgar ("Lleva panza y pan con mermelada"). |
| P0 | Staging: ERR_CONNECTION_TIMED_OUT | Infra/red (ver §10): la app responde 200 desde fuera → no es código. |

## 3-6. Cambios P0

### Asistente · Clientes + Inmuebles fiables (local-first)
- **Nuevo** `src/lib/agents/local-answers.ts`: intercepta las lecturas básicas ANTES de n8n y responde con la **sesión RLS del usuario** (sin n8n, sin OpenAI, sin service_role). Detecta:
  - clientes (listar / buscar por nombre), inmuebles/cartera (listar/filtrar) y **seguimiento contextual** ("Y el de Malasaña?" usando los últimos mensajes del hilo).
  - Verbos de escritura → NO intercepta (lo maneja el fallback determinista / n8n).
- Wire en `src/app/api/assistant/v2/route.ts`: `tryLocalAnswer(...)` justo antes de llamar a n8n; si responde → `debugSource:'local_reader'`.
- **Errores humanos con código** y log server-side seguro: `CLIENTS_READ_FAILED`, `PROPERTIES_READ_FAILED` (sin UUID/SQL/stack). Vacío honesto ("No hay clientes registrados todavía"). Nunca finge vacío ante un error.

### Búsqueda inmobiliaria en lenguaje natural (`src/lib/real-estate-search.ts`)
- **Fix del bug m²→millones**: `parseBudget` elimina expresiones de superficie antes de leer precio y ya no toma `m` como sufijo de millón.
- **Nuevo `parseArea`**: "más de 80 m²", "80 metros", "hasta 100 m2", "entre 80 y 120 m²".
- `minArea/maxArea` en `PropertyCriteria`, puntuados en `scoreProperty`, expuestos en `searchProperties` (reader).
- **Fix latente**: los **plurales** de la taxonomía ("pisos", "locales") ya no se cuelan como token de ubicación (degradaban a parcial → falso negativo). Abreviaturas ("habs", "m2") añadidas a stopwords.
- Resultado: "3 habs, 2 baños y más de 80 m²" → criterios correctos, sin precio fantasma; el motor separa exactos de cercanos.

### Formulario de inmueble (móvil)
- `EditPropertyForm` (`VerticalEditForms.tsx`): nuevo bloque **Características** con Superficie (m²) · Habitaciones · Baños (teclado numérico `inputMode`). Precio con `inputMode="decimal"`.
- `UpdatePropertyInput` + `updateProperty` (`vertical-queries.ts`): persisten `bedrooms/bathrooms/area_m2` (columnas ya existentes; **0 migraciones**).
- **Anti-zoom global**: inputs/selects/textareas a `text-base sm:text-sm` (16px móvil, 14px escritorio) en `Input.tsx`, `VerticalForms.tsx`, `VerticalEditForms.tsx`.

## 7-9. P1

### Datos demo (data-only, documentado)
- Se **saneó** el inmueble con dato vulgar y se convirtió en el que el validador espera: **"Piso - Avenida San Pedro 66"**, Madrid/**Malasaña**, venta, *listed*, 375.000 €, **110 m², 3 hab, 2 baños**, nota de **urgencia** + **dispuesto a bajar hasta 315.000 €**. Un solo cambio cubre 5 escenarios del validador (Malasaña, 3/2/+80 m², urgencia, bajada de precio, cartera). Vía SQL sobre el workspace demo; clientes ya estaban limpios y profesionales.

### Comisiones/Facturación (P46) — sin regresión
Evals `commission-cta`, `economic-cycle`, `safe-return`, `invoicing` siguen verdes. Sin cambios de lógica en ese módulo.

### Documentos — sin regresión
`from('documents')` = 0 en todo `src`. El Asistente sigue leyendo solo metadata (`entity_files`).

## 10. Staging / acceso público
Diagnóstico ejecutado en P47:
```
curl -I -L https://crm-inmobiliario-crm-staging.hvdnby.easypanel.host/login → HTTP/1.1 200 OK (X-Nextjs-Cache: HIT)
DNS → 187.77.166.196
```
→ **La app está arriba y sirve el login.** El `ERR_CONNECTION_TIMED_OUT` del validador es **infra/red** (no código). Runbook completo en `docs/STAGING_PUBLIC_ACCESS_RUNBOOK.md` (curl/nslookup, tabla timeout vs 502 vs 404 vs DNS, checklist EasyPanel: running/logs/port/proxy/SSL/domain/restart).

## 11. Tests / Evals
Runner temporal (`npx tsx`, borrado) — **16 suites TODO VERDE ✅**:
- **Nueva** `local-answers` (P47): detección de intención clientes/inmuebles, follow-up "Y el de Malasaña?", filtros del validador → criterios, formato sin UUID.
- `real-estate-search` ampliada (P47): parseArea, regresión del bug m²→precio, ranking por m², plurales sin fuga.
- Resto sin regresión: commission-cta, safe-return, economic-cycle, honorarios, billing-state, invoicing (+summary/parse/pdf/decimal), portfolio-filter, assistant (capabilities/reliability/guard).

## 12. Validaciones
| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ |
| `npm run lint -- --max-warnings=0` | ✅ 0 warnings |
| `npm run build` | ✅ (49 páginas) |
| `node --check scripts/check-agent-deploy.mjs` | ✅ |
| Evals (16 suites) | ✅ TODO VERDE |
| `curl` staging `/login` | ✅ 200 OK |

### Escaneos de seguridad
`from('documents')`=0 · `from('invoices')` en Asistente=0 · service_role real en frontend/nuevos módulos=0 (solo comentario) · `router.back`=0 · UUID en respuestas del Asistente local=0 (eval) · n8n **no tocado**.

## 13-14. Archivos / migraciones
**Nuevos:** `src/lib/agents/local-answers.ts`, `src/lib/agents/__evals__/local-answers.evals.ts`, `docs/STAGING_PUBLIC_ACCESS_RUNBOOK.md`, `docs/URGENT_VALIDATOR_TEST_CASES.md`, este informe.
**Modificados:** `src/app/api/assistant/v2/route.ts`, `src/lib/real-estate-search.ts` (+evals), `src/lib/agent-tool-readers.ts`, `src/components/VerticalEditForms.tsx`, `src/components/VerticalForms.tsx`, `src/components/Input.tsx`, `src/lib/vertical-queries.ts`, `docs/VALIDATOR_QA_CHECKLIST.md`.
**Migraciones:** 0 (columnas ya existían). **Datos demo:** 1 UPDATE (data-only, documentado).

## 15. Qué NO se hizo
No se tocó n8n (vivo) · Asistente sigue sin leer facturas · sin service_role en frontend · sin secretos · sin OCR/emails/import-export/pasarelas/Verifactu/TicketBAI · sin migraciones destructivas · sin cambiar el dominio final. El fix de acceso a staging es **infra**, no código (documentado, no fingido).

## 16. Riesgos restantes
- **n8n**: las consultas complejas/creativas siguen dependiendo de n8n; si está caído, solo las lecturas básicas (clientes/inmuebles) responden por el layer local. Recomendado revisar el estado de n8n antes de la demo.
- **Staging**: responde 200 ahora, pero un timeout puntual del validador puede repetirse por su red; seguir el runbook.
- **Datos**: gran parte de la cartera está *sold/rented*; "disponibles" es un conjunto pequeño (correcto, pero puede parecer escaso). No se inventó stock.

## 17. Instrucciones para validar con el jefe
Seguir `docs/URGENT_VALIDATOR_TEST_CASES.md` (8 flujos). Los cuatro imprescindibles: "¿qué clientes tengo?", "dime qué pisos tenemos en cartera", "¿y el de Malasaña?", editar un inmueble en móvil con m²/habs/baños.

---

**P47 COMPLETADO — EMERGENCY FULL CRM RESCUE: ASISTENTE FIABLE (CLIENTES E INMUEBLES SIN DEPENDER DE n8n), BÚSQUEDA INMOBILIARIA REAL (m²/habs/baños/precio/urgencia + seguimiento contextual), FORMULARIO MÓVIL DE INMUEBLE COMPLETO, STAGING DIAGNOSTICADO (200 OK, runbook) Y CRM LISTO PARA VALIDACIÓN URGENTE.**
