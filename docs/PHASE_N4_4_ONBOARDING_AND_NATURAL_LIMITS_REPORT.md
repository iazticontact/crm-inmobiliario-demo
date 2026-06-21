# MINI FASE N4.4 — Onboarding, límites naturales y facturación honesta

> 2026-06-21 · Workflow n8n `6mps8YoWu3syldUc` (ACTIVO, gpt-4.1-mini@0.2). **Solo n8n
> (prompt + evals)** → NO toca CRM runtime, NO requiere redeploy. Sin features nuevas.

## Cambios (prompt 8672 -> 9763 chars, quirúrgico, principios)
1. **Onboarding:** si el usuario es nuevo / pide tour / "como funciona", recorrido PRACTICO
   por areas (Clientes, Operaciones, Expedientes, Tareas, Calendario, Documentos) + su rol
   (consulta y resume, aun no crea/modifica). No lista generica.
2. **Facturacion honesta:** NUNCA "no hay facturas / no tiene / no hay vencidas"; di que el
   modulo de facturacion aun no esta activo (no puede consultar facturas reales) y ofrece
   datos fiscales/contacto.
3. **Off-topic / bromas:** responder natural y breve, con humor si encaja, SIN moralinas ni
   rigidez, reconduciendo suave al CRM; no juzgar al usuario.
4. **Fechas:** convertir a hora local de Espana (CET/CEST) si es seguro e indicarlo; si no,
   UTC claramente; nunca inventar zona horaria.

Intacto: PERSONALIDAD/GUIA (N4.2), cierres cortos + read-only elegante (N4.3), PRIORIDAD
(N4.1.1), memoria, tools, activeEntityUpdate, no UUID/lead_score, recovery, seguridad.

## ¿n8n o runtime? Solo **n8n**. **No requiere redeploy.**

## Evals (en vivo)
Nueva categoria `n44_polish` **12/12**. Resultados reales:
- "Hay facturas vencidas?" -> "El modulo de facturacion aun no esta activo... no puedo
  consultar facturas ni vencimientos. ...datos fiscales o de contacto."
- "voy a cagar y vuelvo" -> "Perfecto, aqui te espero." (natural, sin moralina).
- "Cuando fue creado Oier?" -> "...creado el 17 de junio de 2026 a las 13:06 (hora de España)."
Regresion verde: conversation_quality_premium 20/20, memory_chain 7/7, no_uuids 2/2,
n43_polish 11/11. Suite total **171 casos**.

## Veredicto
**N4.4 COMPLETADO — ONBOARDING AND NATURAL LIMITS POLISH.** Onboarding util por areas,
facturacion honesta (sin inventar ausencia de facturas), off-topic natural sin moralinas y
fechas en hora local de Espana. Solo prompt (n8n), sin redeploy, memoria/tools/guardrails
intactas, certificado con 12 evals nuevos + regresion completa.
