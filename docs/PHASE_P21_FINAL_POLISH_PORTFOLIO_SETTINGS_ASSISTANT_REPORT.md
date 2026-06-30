# FASE P21 — Cierre visual: Trámites ordenados, Cartera premium y Asistente IA final 360

> **Fecha:** 2026-06-30 · Cierre visual/funcional del CRM. Lo clave: **los trámites completados ya no
> ensucian la lista activa** (sub-vista Activos/Finalizados/Todos), la **navegación principal de Cartera**
> (Inmuebles · Operaciones · Trámites · Comisiones) es más grande y clara con contadores, y el
> **Asistente resuelve nombres de relaciones** (cliente/inmueble/operación) para no mostrar nunca ids.
> Sin tocar secretos/credenciales/n8n vivo (no hizo falta).

## 1. Diagnóstico global

Staging mostró: (1) trámites "Completado" mezclados con activos; (2) tabs de Cartera demasiado pequeñas
para ser navegación principal; (3) densidad visual alta; (4) Configuración mejorable; (5) Asistente con
ids técnicos en relaciones.

## 2. Problemas en Trámites

`service_cases` con estados open/in_review/documentation_pending/blocked (activos) y resolved=Completado
(+ closed) finalizado. La lista mostraba **todos juntos** ordenados sin separar finalizados → desorden al
crecer.

## 3. Solución Trámites: activos / finalizados / todos

- Sub-vista en la cabecera de Trámites: **Activos · N / Finalizados · N / Todos** (por defecto Activos;
  solo aparece si hay finalizados). El badge de total refleja la vista.
- Al marcar **Completado**, el trámite **sale de Activos** y aparece en Finalizados (derivado, sin
  perderse); si vuelve a otro estado, regresa a Activos. Feedback discreto: *"Trámite completado · Lo
  encuentras en «Finalizados»."*
- **Orden** — Activos: bloqueados primero → vencen antes → sin fecha al final → prioridad. Finalizados:
  más recientes primero (`updated_at`). Sin migración (se usan campos existentes).
- Empty states propios ("No hay trámites activos" / "Aún no hay finalizados") con acceso cruzado.

## 4–5. Cambios visuales en Cartera + navegación principal

- **Tabs principales** (Inmuebles/Operaciones/Trámites/Comisiones): de `text-xs py-1.5` a
  `text-sm px-4 py-2.5`, iconos `h-4`, **contador de lo activo** por pestaña, mejor contraste del activo
  (`bg-gray-900` + `aria-current`), y **scroll horizontal limpio en móvil** (sin apilarse).
- Lista de trámites: cards más respiradas, dropdown de estado limpio, acciones alineadas, sin ids.

## 6. Pulido de listas/cards/dropdowns

Reducción de ruido en Trámites (cards `rounded-xl` con menos líneas, jerarquía de texto, documentos
discretos). El resto de Cartera (Inmuebles con filtros de P19, métricas) se mantiene coherente.

## 7. Cambios en Configuración

Avatar de perfil más elegante: el círculo es **clicable** con una **insignia de cámara** (overlay) que
invita a cambiar la foto; se conservan botones Subir/Cambiar y Eliminar, estado de carga y fallback a
iniciales. Configuración ya era SaaS (P14/P16/P17/P20): Perfil · Empresa · Equipo, sin "workspace",
"Próximamente", chips ni notificaciones falsas.

## 8. Revisión avatar/foto perfil

Verificado P20: subida real (Storage `profile-avatars`, RLS por `auth.uid()`), preview, eliminar,
fallback iniciales, Topbar con `onError`→iniciales, persistencia tras recarga, validación tipo/tamaño,
sin service_role. Pulido visual (cámara overlay, tamaño 16).

## 9. Revisión Asistente IA

Auditado tras P18–P20: lectura fresca (`force-dynamic`), `range` de fechas en calendario y
`crm_read_query`, detalle por entidad, crisis/cost guard, vocabulario. Hueco detectado: las relaciones
salían como **id** (UUID) sin nombre.

## 10. Detail/expand 360 — implementado (parte) + diferido (parte)

**Implementado ahora (backend-only, sin n8n):** `crm_read_query` resuelve en lote los **nombres** de las
relaciones por id (cliente→`client_name`, inmueble→`property_title`, operación→`operation_title`),
RLS por workspace, acotado por el `limit` (máx. 3 queries). Así el agente habla con nombres legibles y
**nunca muestra UUIDs**. El prompt refuerza usar esos nombres.
**Diferido a P22 (con causa):** `detailLevel` (summary/detail/full) y `expand` **bidireccional**
(p. ej. inmueble → sus citas/tareas/operaciones; cliente → todo su contexto) requieren parámetros nuevos
en el schema/jsCode de n8n vivo + agregaciones por entidad con protección de payload; no se mete a medias
en una fase de cierre visual.

## 11. Revisión visual global

Pulido quirúrgico en Cartera (tabs, trámites) y Configuración (avatar). Sin rediseñar todo; se mantiene
funcionalidad. Vocabulario visible limpio (P20 ya corrigió "Lead"/"Próximamente"/"workspace").

## 12. Revisión funcional global

Trámites: completar mueve a Finalizados y persiste; volver a activo funciona. Cartera: filtros/búsqueda/
orden (P19) intactos; tabs con contadores. Avatar: subir/cambiar/eliminar. Todo persiste y se refleja.

## 13. Seguridad

Sin secretos/keys; sin service_role en frontend; RLS respetado (enriquecimiento de nombres filtra por
`workspace_id`); avatar Storage seguro (P20); n8n intacto (no se tocó). Sin UUIDs visibles (relaciones
con nombre).

## 14. Performance

`activeCasesList`/`doneCasesList`/derivaciones de cartera memoizadas; `CASE_PRIO_RANK`/`isFinishedCase`
a nivel de módulo (deps estables). Enriquecimiento de nombres en lote (3 queries máx., acotado por
limit), no N+1.

## 15. Accesibilidad / responsive

Tabs con `aria-current` y área de click mayor; avatar como `button` con `aria-label` y `focus-visible`;
tabs con scroll horizontal en móvil; sub-vista de trámites con botones accesibles.

## 16. Evals / tests

`assistant-coherence.evals.ts` +3 fixtures P21: trámites activos (no mezclar completados), finalizados
(solo cuando se piden; "Completado" visible / `resolved` interno, nunca `completed`), relaciones
legibles (nombres, no ids). Suites previas (portfolio-filter, reliability, avatar) intactas.

## 17. Validaciones

`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅.

## 18. Scans

Sin "workspace"/"Próximamente"/"completed"/"Copiloto"/"expediente" visibles en lo tocado · sin UUID
visible (relaciones con nombre) · sin service_role frontend · sin upload falso · sin temp files en el
repo · n8n no tocado.

## 19. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/app/(saas)/opportunities/page.tsx` | Trámites activos/finalizados/todos + orden; tabs principales más prominentes con contadores |
| `src/lib/agent-tool-readers.ts` | `crm_read_query` resuelve nombres de relaciones (client_name/property_title/operation_title) |
| `src/components/AvatarUploader.tsx` | avatar clicable + insignia de cámara (overlay) |
| `src/lib/agents/nowlabs-main-agent.ts` | reglas: relaciones con nombre (no ids) + trámites activos vs finalizados |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +3 fixtures P21 |

## 20. Migraciones

Ninguna (los trámites usan estados existentes; el enriquecimiento de nombres es solo lectura).

## 21. Cambios n8n

**Ninguno.** El enriquecimiento de nombres viaja en la respuesta JSON existente de `crm_read_query`; no
requiere cambiar schema/jsCode del workflow vivo.

## 22–23. Commit / Push

Commit `feat(ux): trámites activos/finalizados, tabs de Cartera prominentes, relaciones con nombre (P21)`
→ `origin/main`.

## 24. Deploy

Solo **redeploy del frontend/backend** (relación de nombres en `crm_read_query`). Sin migraciones, sin
n8n.

## 25. Checklist staging

- [ ] Trámites: por defecto se ven solo los activos; marca uno como Completado → desaparece de Activos,
      aparece en Finalizados; vuélvelo a activo → regresa. Contadores correctos.
- [ ] Cartera: las 4 pestañas se ven grandes/claras con contador; en móvil hacen scroll horizontal.
- [ ] Configuración: clic en el avatar (o en la cámara) abre el selector; subir/cambiar/eliminar foto.
- [ ] Asistente: "¿qué trámites tengo activos?" (no mezcla completados); "¿cuáles he completado?"
      (aparte); "detalla esa cita/operación" → muestra NOMBRES de cliente/inmueble, nunca ids.
- [ ] Sin términos prohibidos visibles, sin UUIDs, sin botones muertos.

## 26. Pendientes honestos

- **detailLevel/expand bidireccional** del asistente (inmueble→sus citas/tareas/operaciones, cliente→
  todo su contexto): **P22** (requiere schema/jsCode n8n + agregaciones con protección de payload).
- **Logo de empresa**: pendiente (P20/P22).
- **Centro de notificaciones**: superficie vacía honesta.
- Pulido visual más profundo (densidad global) se ha hecho quirúrgicamente; una pasada de diseño
  completa queda como mejora continua.

## 27. Veredicto

**P21 COMPLETADO — CRM PULIDO VISUALMENTE, TRÁMITES ORDENADOS, CONFIGURACIÓN PREMIUM Y ASISTENTE IA FINAL
REVISADO.** Los trámites completados ya no ensucian la lista activa (Activos/Finalizados/Todos con orden
y contadores); la navegación principal de Cartera destaca como debe; el avatar de Configuración queda
elegante; y el Asistente resuelve nombres de relaciones para no mostrar nunca ids. `tsc`/`lint`/`build`
en verde. detailLevel/expand bidireccional queda documentado para P22.
