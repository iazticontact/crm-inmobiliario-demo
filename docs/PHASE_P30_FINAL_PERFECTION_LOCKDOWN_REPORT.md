# FASE P30 — Final Perfection Lockdown: Asistente IA omnicontextual, cero falsos negativos, QA total

> **Fecha:** 2026-07-01 · Último barrido de perfección sobre la base (sin extras). Foco: el Asistente debe
> leer TODO el CRM con tools (no memoria) y el motor inmobiliario no debe dar falsos negativos. Enfoque
> quirúrgico: **auditar, corregir solo gaps reales, ampliar evals y verificar E2E** — no reescribir lo que
> ya funciona (P27–P29). **Sin tocar n8n** (autorización expresa: no era imprescindible).

---

## 1. Diagnóstico inicial (qué quedaba tras P29)
El motor inmobiliario (P29) y móvil (P28C) ya estaban sólidos y verificados E2E. La auditoría de las tools
del Asistente encontró **gaps reales de lectura** (no de UI): `crm_read_query` **no exponía las comisiones**
de las operaciones ni algunas **relaciones** de tareas/trámites → el Asistente no podía responder bien sobre
comisiones ni vincular tarea/operación con su inmueble por nombre.

## 2. Causa de los bugs encontrados
Config de columnas incompleta en `CRM_QUERY_ENTITIES`: `opportunities` sin `commission_*`/`property_id`,
`tasks` sin `client_name`/`property_id`/`opportunity_id`, `service_cases` sin `property_id`/`opportunity_id`.
Sin esas columnas, ni el dato de comisión ni la resolución de nombres de relación llegaban al LLM.

## 3. Asistente IA omnicontextual (fix)
`crm_read_query` ahora expone, por entidad:
- **opportunities:** `value, currency, commission_rate, commission_status, commission_paid_amount, property_id`
  (+ los ya existentes). → responde comisiones y vincula la operación a cliente/**inmueble por nombre**.
- **tasks:** `client_name, property_id, opportunity_id`. → vincula la tarea a su cliente/inmueble/operación.
- **service_cases:** `property_id, opportunity_id`. → vincula el trámite a inmueble/operación.
- `enrichRelationNames` resuelve `client_name`/`property_title`/`operation_title` para todas (nunca ids).
- **Verificado E2E** (backend local + Supabase real): las 7 entidades leen en vivo (count>0, sin errores 400);
  una operación devuelve `commission_rate=3.1, commission_status='cobrada'`, `property_title` y `client_name`
  resueltos por nombre. Documentos = metadata real (`entity_files`, P27). País/idioma del cliente vía metadata.

## 4. Motor inmobiliario (auditado, sin regresiones)
`real-estate-search.ts` (P29) auditado: normalización con acentos, sinónimos (piso/apartamento;
casa/chalet/adosado/pareado/villa; local/oficina/garaje/terreno/nave; genéricos vivienda/inmueble/propiedad),
operación (comprar/invertir→venta, alquilar→alquiler), presupuesto es-ES (hasta/entre/mil/millones/mensual),
habitaciones/baños, notas y ranking exacto/parcial con motivos. **Reforzado con evals de regresión** que
garantizan que filler/presupuesto/atributos/intención/estado **no** se tomen como localidad (el bug de
falsos negativos de P29) y que una localidad real (p. ej. "bilbao") sí se detecte.

## 5. Disponibilidad
`isPropertyClosed` (sold/rented/archived) · `isPropertyCommerciallyActive` (todo lo demás con estado) ·
`availabilityAllows(status, mode)` (available excluye cerrados / all / closed). Cerrados nunca aparecen como
disponibles; si no hay exactos, se ofrecen parciales con aviso. Cubierto por evals.

## 6. Sinónimos / taxonomía
Diccionarios en `real-estate-search.ts` (sin ejemplos concretos de validadores). Genéricos no filtran por
tipo. Verificado E2E ("viviendas disponibles", "piso o apartamento", "casa o chalet", "invertir").

## 7. Notas / precio / comisión
El motor consulta **notas** (ubicación/condiciones) y `search_properties` las devuelve (clamp 400). El
microparche del fallback (P29) indica explicar **precio listado vs. notas** si difieren ("según las notas…").
Comisiones ahora legibles vía `crm_read_query` (rate/status/paid) — control interno, **nunca factura**.

## 8. Falsos positivos de factura
`ai.ts` (P29): solo facturación explícita dispara la intención; precio/comisión/presupuesto/€/venta/alquiler
**no**. Reforzado con evals ejecutables (`prepara una factura…`→invoice; `comisión de esta venta`→no invoice).

## 9. Cliente país/idioma (auditado)
Autocompletes accesibles (`AutocompleteSelect` + `geo-language-data`), persisten en metadata (leído por el
Asistente), columnas dedicadas additivas. Móvil sin auto-zoom (16px, P28C). Sin cambios en P30 (ya correcto).

## 10. Inmueble m²/hab/baños (auditado)
Columnas reales; inputs en el alta (P29); card/ficha ya los muestran; `search_properties` y `crm_read_query`
los exponen al Asistente. Sin cambios en P30 (ya correcto).

## 11. Mobile final
Sin cambios nuevos: la regla global de P28C (form controls ≥16px en móvil + viewport `viewport-fit=cover` +
`min-h-dvh` en auth) cubre todos los inputs, incluidos los autocompletes y los numéricos nuevos. Checklist
humano (iPhone Safari / Chrome Android) heredado de P28B/C (§ pendientes).

## 12. UI / copy / scans
Re-escaneo de términos prohibidos visibles en base: **limpio** (los restos siguen en superficies internas
gateadas por `NEXT_PUBLIC_NOWLABS_INTERNAL`). Sin `service_role` frontend, sin UUID a usuario, sin JSON
técnico visible, sin Copiloto/NowLabs/Próximamente. Los cambios de P30 son de backend/evals (no tocan UI).

## 13. Backend / tools
`CRM_QUERY_ENTITIES`: opportunities (+comisiones/property_id), tasks (+relaciones), service_cases
(+relaciones). `searchProperties` semántico (P29) intacto. Contrato de tools (`toolVersion`,
source/generatedAt) y `/api/agent/diag` intactos. Sin exponer ids al usuario (enrich→nombres).

## 14. Prompt / fallback / capabilities
Sin cambios nuevos en P30. El microparche generalizado de P29 (búsqueda no literal, exactos/parciales, notas,
país/idioma, factura solo explícita) vive en el **fallback local**. **El prompt vivo de n8n NO se toca**
(autorización expresa del usuario en P29: no imprescindible; el motor de backend hace el trabajo).

## 15. Tests / evals
- **`real-estate-search.evals.ts`** (P29 + P30): +regresión de extracción de ubicación (no-leak de
  filler/presupuesto/atributos/intención/estado; localidad real sí).
- **`assistant-coherence.evals.ts`** (+5 fixtures P30, genéricas): vivienda disponible (no "no hay"),
  piso/apartamento por presupuesto+habitaciones, casa/chalet + invertir, comisión de operación (≠ factura,
  inmueble por nombre), ficha de cliente con país/idioma.
- Suites intactas: `assistant-diag`, `assistant-expand`, `assistant-reliability`, `portfolio-filter`,
  `profile-avatar`, `product-capabilities`.

## 16. Validaciones
`npx tsc --noEmit` ✅ · `npm run lint -- --max-warnings=0` ✅ · `npm run build` ✅ ·
`node --check scripts/check-agent-deploy.mjs` ✅ · **E2E probe** (7 entidades + comisión + relaciones) ✅ ·
git limpio · sin temp files · sin secretos · sin service_role frontend · sin features extra.

## 17. Archivos tocados
| Archivo | Cambio |
|---|---|
| `src/lib/agent-tool-readers.ts` | `crm_read_query`: opportunities (+comisiones/property_id), tasks + service_cases (+relaciones) |
| `src/lib/__evals__/real-estate-search.evals.ts` | +regresión de extracción de ubicación |
| `src/lib/agents/__evals__/assistant-coherence.evals.ts` | +5 fixtures omnicontexto/inmobiliario |

## 18. Migraciones
Ninguna nueva (la de P29 ya cubría país/idioma; las columnas de comisión/relaciones ya existían).

## 19. Cambios n8n
**Ninguno.** El fix es de backend; el LLM ya recibe comisiones y relaciones por nombre. No imprescindible.

## 20–21. Commit / Push
Commit `fix(p30): Asistente omnicontextual — comisiones + relaciones en crm_read_query + evals` → `origin/main`.

## 22. Deploy necesario
Redeploy del frontend/backend para servir las columnas nuevas del Asistente. Sin acción de BD (nada nuevo).

## 23. Pendientes honestos
1. **QA humano en dispositivo real** (iPhone Safari / Chrome Android) — no ejecutable desde aquí; checklist en
   P28B/C. No bloqueante (build verde, reglas correctas).
2. **n8n live prompt:** microparche preparado (P29 §14/§20), no aplicado por decisión del usuario. Opcional.
3. **Ficha visual de cliente:** el Asistente lee país/idioma (metadata); mostrarlos también en la UI de detalle
   es mejora menor pendiente.
4. **Verificación de deploy real** (P26): ejecutar `check-agent-deploy.mjs` contra el dominio en el 1er deploy.

## 24. Veredicto
**P30 COMPLETADO — CRM BASE EN PERFECCIÓN FINAL: ASISTENTE IA INMOBILIARIO ROBUSTO, MOBILE CERRADO Y DATOS
PROFESIONALES.** El Asistente ahora lee **todo** el CRM en vivo por entidad (clientes, inmuebles, operaciones
con **comisiones**, trámites, tareas, calendario, actividad, documentos-metadata) resolviendo relaciones por
**nombre** (nunca ids); el motor inmobiliario evita falsos negativos (exactos + parciales con motivos,
disponibilidad, sinónimos, presupuesto, notas), verificado E2E contra Supabase real; precio/comisión no se
confunden con factura; país/idioma y m²/hab/baños están integrados de punta a punta; y móvil sigue sin
auto-zoom ni overflow. `tsc`/`lint`/`build`/E2E en verde. Sin tocar n8n. Listo para la siguiente prueba con
validadores (con QA humano de dispositivo como verificación final).
