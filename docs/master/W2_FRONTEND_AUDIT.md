# CRM TELECOM — Auditoría frontend W2

- Versión: 1.0
- Fecha: 2026-09-25
- Commit base: `6ea06e4`
- Commit implementado y remoto: `f8b6466989f5b54a18fb5a9b70b25b9c883ddb41`
- Rama: `w2/frontend-audit-foundation`
- Owner: W2 — Frontend / UX
- Estado: primera unidad implementada, validada y persistida en GitHub
- Supersedes: ninguno

## 1. Resultado ejecutivo

El frontend existente tiene una base aprovechable: App Router, shell responsive, primitives compartidos, estados de carga en las rutas principales, facturación PRO desacoplada, demo mode y un dashboard que ya intenta funcionar como centro operativo.

No conviene reescribirlo. La estrategia correcta es extraer boundaries de forma incremental y sustituir verticalización inmobiliaria solo cuando W1 publique contratos telecom canónicos.

La deuda dominante es estructural:

- las 13 páginas SaaS son Client Components;
- la carga de datos se concentra en `useEffect` y funciones de consulta importadas directamente;
- hay seis páginas de más de 1.000 líneas y cuatro de más de 2.000;
- no había ningún `error.tsx` en el área SaaS;
- formularios, filtros, modales y estados vacíos se implementan de forma desigual;
- el producto sigue expresando el vertical inmobiliario en navegación, copy y modelos de presentación.

## 2. Mapa de producto actual

| Ruta | Rol actual | Tamaño aproximado | Riesgo principal |
| --- | --- | ---: | --- |
| `/dashboard` | Resumen comercial y actividad | 1.235 líneas antes de esta rama | Mezcla fetching, derivados, acciones y widgets |
| `/clients` | Listado, búsqueda y alta/edición | 994 | Formulario local grande; metadata inmobiliaria acoplada |
| `/clients/[id]` | Ficha 360 | 1.517 | 40 estados; tabs y dominios en un único componente |
| `/opportunities` | Cartera, pipeline, casos, comisiones | 2.021 | 47 estados; seis submódulos en una página |
| `/calendar` | Calendario local + Google | 2.763 | 32 estados, 11 effects y lógica de sincronización en UI |
| `/assistant` | Chat, acciones, automatizaciones y hallazgos | 4.374 | Boundary crítico compartido con W3; lógica de producto mezclada |
| `/assistant/findings` | Centro de hallazgos | 256 | Sin loading de ruta; patrón de error ad hoc |
| `/settings` | Workspace, equipo e integraciones | 1.682 | 30 estados; múltiples responsabilidades |
| `/facturacion` | Facturación PRO | 644 + componentes dedicados | Activo a preservar; revisión fiscal fuera de este scope |
| `/billing` | Facturación legacy | 551 | Duplicidad conceptual y de navegación |
| `/inbox` | Bandeja/WhatsApp | 1.065 | Backend incompleto; ruta interna según flags |
| `/automations` | Automatizaciones n8n | 621 | Ruta interna; tabla y estados propios |

## 3. Arquitectura y boundaries

### Base positiva

- `AppShell`, `Sidebar` y `Topbar` separan el chrome global.
- `PageHeader`, `SectionCard`, `Button`, `Badge`, `EmptyState`, `ConfirmDialog` y `PageSkeleton` forman un sistema inicial reutilizable.
- Facturación PRO ya usa `src/components/invoicing/*` y `src/lib/invoicing/*`.
- `loading.tsx` existe para dashboard, clientes, ficha de cliente, cartera, calendario, asistente y settings.
- El shell cambia a drawer por debajo de `lg` y evita scroll horizontal global.

### Deuda estructural verificada

Archivos frontend principales por tamaño en el commit base:

1. `assistant/page.tsx`: 4.374 líneas.
2. `calendar/page.tsx`: 2.763 líneas.
3. `opportunities/page.tsx`: 2.021 líneas.
4. `settings/page.tsx`: 1.682 líneas.
5. `clients/[id]/page.tsx`: 1.517 líneas.
6. `dashboard/page.tsx`: 1.235 líneas.
7. `inbox/page.tsx`: 1.065 líneas.
8. `clients/page.tsx`: 994 líneas.

Los mayores riesgos de conflicto multi-Work están en asistente, calendario, cartera, Cliente 360 y settings. W2 no debe mover lógica de W1/W3 desde esos archivos sin contrato o handoff.

## 4. Data fetching y estado

- 13/13 páginas SaaS declaran `'use client'`.
- No se usa una capa de cache/queries como TanStack Query o SWR.
- Cada página gestiona carga, error, demo mode, cancellation y refresco con estado local.
- Hay fallbacks `.catch(() => [])` que mantienen la UI viva, pero pueden ocultar fallos parciales.
- Dashboard ejecuta nueve consultas principales en paralelo y después deriva snapshot económico y operativo.
- Calendario combina persistencia local, datos CRM, integración Google, selección de calendarios y CRUD en el mismo componente.
- Cliente 360 y cartera concentran decenas de estados independientes; son candidatos a hooks/controladores por feature.

Recomendación: no introducir una librería global durante la primera fase. Extraer primero `useFeatureController`, mappers y componentes por feature; después evaluar una capa de cache con evidencia de waterfalls o revalidación duplicada.

## 5. Estados de producto

### Loading

Hay buen punto de partida con `PageSkeleton`. Esta rama completa los `loading.tsx` que faltaban en findings, automations, billing, facturación PRO, inbox y detalle de inmueble, reutilizando variantes presentacionales sin añadir consultas.

### Error

No existía ningún error boundary de ruta. Esta rama añade `src/app/(saas)/error.tsx` como fallback común con reintento y retorno al dashboard. Los errores de fetching siguen siendo responsabilidad de cada feature.

### Empty

`EmptyState` existía, pero solo tres páginas lo importaban. Esta rama migra tres duplicados equivalentes en hallazgos y facturación; quedan estados específicos por clasificar antes de generalizarlos. Debe estandarizarse por intención: `first-use`, `no-results`, `no-data-yet` y `filtered-empty`.

## 6. Accesibilidad y responsive

### Hallazgos positivos

- foco visible en `Button` y enlaces principales;
- drawer móvil con `role="dialog"`, `aria-modal` y cierre con Escape;
- inputs a 16 px en móvil para evitar zoom de iOS sin bloquear pinch zoom;
- tablas envueltas de forma responsive en los módulos principales;
- botones de icono importantes suelen incluir `aria-label`.

### Deuda

- `Input` no asociaba `label`, campo y mensaje de error. Corregido en esta rama con `useId`, `htmlFor`, `aria-invalid`, `aria-describedby` y `role="alert"`.
- `Input` no está adoptado directamente por las páginas SaaS; predominan campos raw y helpers locales.
- `SideDrawer`, `ConfirmDialog` y drawer de navegación no implementan focus trap ni restauración de foco.
- Muchos formularios visuales no usan `<form>`, lo que reduce submit por teclado y semántica.
- Las animaciones no tienen aún una política común `prefers-reduced-motion`.
- Las vistas calendario/pipeline requieren pruebas visuales reales en 320, 375, 768, 1024 y 1440 px.

## 7. Information architecture y navegación

La IA actual sigue siendo inmobiliaria:

- `Clientes` describe compradores, propietarios y leads.
- `Cartera` agrupa inmuebles, operaciones y trámites.
- hay dos rutas etiquetadas como Facturación (`/billing` y `/facturacion`);
- la búsqueda global del topbar busca clientes, no contratos, servicios, líneas, tareas u oportunidades;
- la ficha de cliente contiene pestañas útiles, pero carece del modelo telecom canónico.

La auditoría encuentra aproximadamente 160 apariciones de “inmueble” en TSX del área SaaS/componentes, además de venta, alquiler, comprador y visita. No deben sustituirse por search/replace.

## 8. Facturación

`/facturacion` es el módulo a preservar. Usa componentes dedicados para dashboard, editor, preview, importes decimales y prompt builder, y repositorios/lógica bajo `src/lib/invoicing`.

No se ha modificado su contrato. La duplicidad `/billing` debe resolverse por decisión de producto/ADR, no desde una limpieza visual aislada.

## 9. Mapa de deuda

### P0 — bloquea la verticalización correcta

1. La API de GitHub reporta el repositorio como `public`, en contradicción con la instrucción del Project de mantenerlo privado. W0/W4 deben resolver la visibilidad de inmediato; W2 no cambia permisos del repositorio.
2. Falta contrato versionado W1 para cliente/empresa, contactos, servicios/líneas, contratos, operador, permanencia y renovación. W2 no debe fijar campos definitivos hasta recibirlo.
3. Falta contrato W3 de presentación de resultados IA: referencias, deep links, previews, confirmaciones, tablas/cards y acciones propuestas.
4. Los god-components compartidos elevan el riesgo de conflicto entre Works. Cualquier cambio grande en asistente/calendario/Cliente 360 debe empezar por boundaries y ownership de archivos.

### P1 — siguiente fase W2

1. Extraer dashboard en `features/dashboard` y después aplicar el patrón a clientes/calendario sin mover contratos de datos.
2. Separar Cliente 360 por tabs y crear slots telecom desacoplados.
3. Separar calendario en controller, calendar grid, agenda, editor e integración Google.
4. Dividir asistente por shell, thread list, transcript, composer y cards contractuales coordinadas con W3.
5. Unificar empty/loading/error states y añadir fallbacks a rutas secundarias.
6. Hacer búsqueda global extensible por entidad con contrato W1.
7. Resolver navegación y copy duplicado de facturación mediante ADR.
8. Crear primitives de formulario accesibles y migrar formularios incrementales.
9. Añadir pruebas de componentes/flows críticos y axe en CI junto a W4.

### P2 — consistencia y acabado

1. Formalizar tokens semánticos de color, espaciado, radios y elevación.
2. Estandarizar filtros, toolbars, tablas responsive y drawers.
3. Añadir política `prefers-reduced-motion`.
4. Crear catálogo de componentes/estados y ejemplos de uso.
5. Sustituir tooltips basados solo en `title` por un primitive accesible donde aporten información esencial.
6. Revisar densidad y truncado con datos telecom reales y nombres largos.

## 10. Primera unidad implementada

- Nueva carpeta `src/features/dashboard`.
- Extraídos view-model, formateadores y componentes presentacionales del dashboard.
- `dashboard/page.tsx` pasa de 1.235 a 943 líneas sin cambiar queries ni contratos.
- La semana operativa añade nombre accesible completo por día.
- `Input` compartido asocia label y error correctamente.
- Nuevo error boundary SaaS con reintento.
- Fallbacks de carga completos para las 13 rutas SaaS, incluidos los segmentos secundarios.
- Estados vacíos compartidos en hallazgos, facturación legacy y facturación PRO sin cambiar su lógica.

## 11. Validación

- `npm ci`: PASS.
- `npx tsc --noEmit`: PASS.
- ESLint del scope modificado: PASS.
- `npm run build`: PASS; 50 páginas generadas.
- Smoke HTTP de `/dashboard` con `next start`: 200.
- Revisión visual remota: bloqueada porque el navegador cloud no puede abrir el localhost del runtime. No se registra como PASS.
- Baseline ESLint global: 0 errores y 3 warnings preexistentes fuera del scope W2.

## 12. Próxima unidad segura

1. Añadir pruebas de unidad para `features/dashboard/model` cuando W4 confirme runner.
2. Extraer del dashboard los bloques `Today`, `Deadlines` y `RecentActivity` como widgets.
3. Preparar shell desacoplado de Cliente 360 con slots, sin crear campos telecom.
4. Migrar formularios de clientes a primitives accesibles por secciones pequeñas.
