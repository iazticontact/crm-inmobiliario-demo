# FASE P6.16 — Inmuebles final premium + arranque de ficha de inmueble

> **Fecha:** 2026-06-23 · UI/UX de la pestaña Inmuebles + **ficha de inmueble real** (P7.1 prep) +
> módulo compartido `property-display` + **migración ligera de datos de ejemplo**. Requiere redeploy.

## 1. Diagnóstico (staging)
- El toggle "Ver vendidos y alquilados (N)" pasaba desapercibido.
- Al mostrar histórico, el grid mezclaba activos y cerrados sin orden claro.
- No se entendía el ciclo del inmueble (captación → publicado → reservado → vendido/alquilado →
  histórico) ni qué estaba activo vs cerrado.
- Las cards solo permitían "Editar"; no había acceso a una ficha dedicada.
- Una **captura de pantalla** estaba subida como foto de un inmueble de ejemplo (confunde el demo).

## 2. Histórico — segmented control (era un toggle invisible)
Sustituido el enlace por un **segmented control premium** en la cabecera de la sección:
**Activos · Histórico (N) · Todos** (solo aparece si hay histórico). Por defecto **Activos**. El
histórico ya no se mezcla por accidente.

## 3. Ordenación del grid (módulo `property-display`)
- **Activos**: Reservado / bajo contrato → Publicado / disponible → Captación.
- **Histórico**: Vendido → Alquilado → Archivado.
- Desempate por `updated_at` descendente (más reciente primero).
- Vista **Todos**: dos secciones con cabecera **"Cartera activa · N"** y **"Histórico · N"** (no se
  mezclan; orden claro en cada bloque).

## 4. Cards de inmueble (antes / después)
| | Antes | Después |
|---|---|---|
| Click en card | abría el **drawer de edición** | **navega a la ficha** del inmueble (`/opportunities/properties/[id]`) |
| CTA | solo "Editar" | card clicable + indicador **"Ver ficha ›"** + "Editar" en el pie |
| Estado (select) | opciones genéricas con "Vendida / alquilada" | **Captación · Publicado · Reservado · Vendido/Alquilado (según operación) · Archivado** |
| Cierre a histórico | cambio directo | **confirmación**: "Saldrá de la cartera activa y quedará en el histórico. No se elimina nada…" |
| Precio | `285.000 €` / `1.100 €/mes` | igual (alquiler con **€/mes**) |
| Operaciones | "N operaciones vinculadas" | igual + "Sin operaciones" cuando no hay |
| Hover | plano | sombra premium al pasar el ratón |

Se conservan foto/placeholder, tipo de operación, estado, título, ref+tipo, hab/baños/m², ubicación
y propietario/contacto.

## 5. Estados y copy
- Etiquetas visibles: **Captación · Publicado · Reservado · Vendido · Alquilado · Archivado**
  (claves internas `prospecting/listed/under_contract/sold/rented/archived` intactas).
- El select de la card es **contextual**: en inmuebles de alquiler la opción de cierre es
  **"Alquilado"** (→ `rented`); en venta, **"Vendido"** (→ `sold`). Adiós al "Vendida / alquilada"
  combinado y ambiguo.
- Pasar a histórico (vendido/alquilado/archivado) **pide confirmación** y **no borra** fotos,
  documentos, operaciones ni trámites.

## 6. Fotos
- Las fotos siguen funcionando (Storage + signed URLs, portada batch). No se tocó la lógica.
- **Entorno de ejemplo:** se eliminó la **captura de pantalla** subida como foto del inmueble «Piso
  3 dorm. - Calle Mayor 14» (confundía el showcase). Se borró su fila en `entity_files` (la card
  vuelve al placeholder elegante). El objeto binario en Storage **no se borra por SQL** (Storage lo
  protege); queda huérfano e inaccesible en el bucket privado. Acotado al workspace de ejemplo,
  idempotente. **No se tocó ningún archivo de cliente real.**

## 7. Ficha de inmueble (P7.1 PREP) — creada y REAL (no botón muerto)
Ruta nueva: **`/opportunities/properties/[id]`** (refresh-safe; carga sus propios datos por id):
- **Cabecera**: portada + galería (miniaturas), operación, estado, título, ref/tipo, ubicación,
  precio (€ o €/mes), botón **Editar** (reutiliza `EditPropertyDrawer`).
- **Datos del inmueble**: tipo, operación, estado, características, propietario/contacto, teléfono,
  precio, actualizado, notas.
- **Operaciones vinculadas** (por `property_id`/metadata) con su estado comercial.
- **Trámites vinculados** (de esas operaciones) con su estado.
- **Documentos del inmueble**: `EntityDocumentsManager` real (`entity_type='property'`, subir/abrir/
  borrar, signed URLs, RLS, sin service_role). En modo demo se indica que no hay documentos reales.
- "Volver a Cartera" y estado **"Inmueble no encontrado"** si el id no existe / sin acceso.
- El CTA "Ver ficha" de la card **apunta a esta ruta real** (sin botones muertos).

## 8. Rendimiento (auditoría)
- Cartera (sin cambios de coste): `Promise.all` de listas, **cover URLs batch**, **doc counts
  agregados**, **client names agregados**, sin N+1, signed URLs de documentos solo al abrir el
  gestor, estado local en acciones (sin F5). Ordenación = sort O(n·log n) sobre arrays pequeños.
- **Ficha**: carga **solo al entrar** (no se precarga desde la cartera). Usa `Promise.all`
  (propiedad + operaciones + trámites + clientes) y genera signed URLs de la galería de ese inmueble.
  Reutiliza queries RLS-safe; sin N+1. *(Optimización futura: fetch puntual por id; hoy reutiliza las
  listas del workspace, coste bajo en datos reales de una agencia.)*

## 9. Refactor de soporte
- Nuevo **`src/lib/property-display.ts`** (compartido por la pestaña y la ficha): `PROPERTY_TYPE_LABEL`,
  `PROPERTY_OPERATION_LABEL`, `PROPERTY_STATUS_META`, `propLabel`, `propNum`, `isRentalProperty`,
  `isClosedPropertyStatus`, `formatPropertyPrice`, orden (`ACTIVE_STATUS_RANK`/`HISTORY_STATUS_RANK`,
  `sortPropertiesByStatus`). Elimina duplicación y evita que las etiquetas deriven entre vistas.

## 10. Qué NO se tocó
n8n · Asistente IA · Auth/onboarding · Clientes · Calendario · Dashboard · Storage **policies** · RLS
· `.env.local`/secretos · **service_role (sin uso en frontend)** · facturación/impuestos/gastos/
beneficio. Lógica de comisiones intacta. Fotos (lógica) intacta. Migración **solo de datos del
workspace de ejemplo**.

## 11. Validaciones
- `npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅
  (`✓ Compiled successfully`; ruta `/opportunities/properties/[id]` compilada).
- Scans: sin probabilidad/pipeline/lead/expediente visibles; sin service_role/secretos en frontend
  (solo comentario); **sin botón muerto** (ruta de ficha real); sin "Vendida / alquilada" combinado;
  sin UUID visible.

## 12. Checklist QA (staging)
**Inmuebles**
- [ ] Por defecto se ven **solo activos**; segmented control **Activos · Histórico (N) · Todos** bien
      visible.
- [ ] Vendidos/alquilados **no se mezclan**; en "Todos" hay cabeceras "Cartera activa" / "Histórico".
- [ ] Cards ordenadas (reservados → publicados → captación; histórico vendidos → alquilados →
      archivados).
- [ ] Precio alquiler "€/mes", venta "€"; estado claro.
- [ ] Cambiar estado a vendido/alquilado/archivar → **confirma** "saldrá de la cartera activa…
      histórico"; no borra nada.
- [ ] Fotos siguen funcionando; el inmueble de ejemplo ya no muestra la captura (placeholder).
- [ ] "Editar" sigue funcionando.

**Ficha**
- [ ] Click en card → abre **/opportunities/properties/[id]** real; carga rápido; refresh directo no
      rompe; "Volver a Cartera" funciona.
- [ ] Muestra portada/galería, datos, operaciones y trámites vinculados, documentos del inmueble.
- [ ] "Editar" desde la ficha actualiza los datos; subir/abrir/borrar documentos funciona.

**Rendimiento**
- [ ] Abrir Cartera y cambiar Activos/Histórico va rápido; abrir ficha va rápido; sin F5 para cambios
      normales.

## Veredicto
**P6.16 COMPLETADO — INMUEBLES FINAL PREMIUM.** Inmuebles queda como una **cartera inmobiliaria clara
y premium**: histórico bien separado con segmented control, grid ordenado por ciclo del inmueble,
cards con estado contextual y confirmación al pasar a histórico (sin borrar nada), copy de estados
limpio, y **ficha de inmueble real** (`/opportunities/properties/[id]`) que hace vivo el CTA "Ver
ficha" — arranque sólido de P7.1. Captura de pantalla de ejemplo retirada. Rendimiento intacto.
`tsc`/`lint`/`build` en verde; migración solo de datos de ejemplo (idempotente). Requiere redeploy.
