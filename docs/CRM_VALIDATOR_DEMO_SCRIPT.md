# Guion de demostración del CRM (15–20 min)

> Recorrido comercial para enseñar el CRM a un cliente o validador. Datos ya cargados en el workspace de
> demostración (Inmobiliaria Costa Azul): 9 clientes, 8 inmuebles, 8 operaciones, 5 trámites, 11 tareas,
> 12 citas y 3 facturas. Sigue los pasos en orden; para cada uno tienes **qué mostrar**, **qué se ve** y
> **qué decir**.

---

### 1) Entrada y Dashboard (1 min)
- **Mostrar:** inicia sesión → **Dashboard**.
- **Se ve:** KPIs reales (clientes, inmuebles, operaciones, próximas citas) sin datos técnicos.
- **Decir:** «Este es el panel de control: de un vistazo ves el estado de tu inmobiliaria.»

### 2) Clientes (2 min)
- **Mostrar:** **Clientes** → abre *Javier Ortega Ruiz* (o *Inversiones Atlántico SL*).
- **Se ve:** ficha 360 con datos de contacto/fiscales, operaciones, tareas, citas y actividad.
- **Decir:** «Cada cliente tiene su ficha completa; todo lo relacionado está aquí.»

### 3) Documentos del cliente (1 min)
- **Mostrar:** en la ficha, pestaña **Documentos** → sube un PDF y descárgalo.
- **Se ve:** el documento se sube, aparece con su tipo y se descarga por enlace seguro.
- **Decir:** «Los documentos se guardan cifrados y privados de tu cuenta.»

### 4) Cartera (2 min)
- **Mostrar:** **Cartera** → filtra por tipo (piso/chalet/local) y estado.
- **Se ve:** inmuebles como tarjetas con precio, zona, m², habitaciones y baños.
- **Decir:** «Tu catálogo de inmuebles, con fotos y documentos por propiedad.»

### 5) Buscar vivienda por presupuesto (1 min)
- **Mostrar:** **Asistente** → escribe «busco un piso en venta **entre 200 y 250 mil**».
- **Se ve:** lista de inmuebles reales dentro de ese rango de precio.
- **Decir:** «Puedes buscar en lenguaje natural; entiende presupuestos, zonas y características.»

### 6) Asistente — cliente y agenda (2 min)
- **Mostrar:** pregunta «resúmeme a *Lucía Herrera*» y «¿qué **citas** tengo esta semana?».
- **Se ve:** resumen del cliente y próximas citas, con nombres legibles (nunca códigos).
- **Decir:** «El Asistente lee tus datos reales; consulta y resume, no inventa.»

### 7) Calendario (1 min)
- **Mostrar:** **Calendario** → crea o edita una cita.
- **Se ve:** agenda y próximas citas; en móvil se ve igual de bien.
- **Decir:** «Tu agenda de visitas y disponibilidad, integrada con clientes e inmuebles.»

### 7b) Factura de honorarios desde una operación (2 min)
- **Mostrar:** **Operaciones → Comisiones** → en *«Compra chalet Los Robles»* pulsa **«Facturar honorarios»**.
- **Se ve:** se abre Facturación con un borrador **prellenado**: cliente, inmueble, concepto «Honorarios de
  intermediación inmobiliaria», y la base = **comisión** (p. ej. 16.800 € = 3% de 560.000 €), **no** el
  precio de la vivienda. Banner: «Factura generada desde una operación inmobiliaria».
- **Decir:** «Desde una operación cerrada facturas tus honorarios en un clic; el IVA va sobre la comisión.»
- **Nota:** si vuelves a pulsar, avisa de que «esta operación ya tiene una factura vinculada» y la abre (no
  duplica). En Comisiones verás el estado de la factura junto a la operación.

### 8) Facturación — crear por texto (3 min)
- **Mostrar:** **Módulos extra → Facturación** → «Crear con texto»:
  «Factura a *Inversiones Atlántico SL* por una comisión de venta de 3.500 € + IVA, vencimiento en 15 días».
- **Se ve:** una **propuesta** con cliente, importe, IVA, vencimiento detectados.
- **Decir:** «Describe la factura y la prepara por ti; tú siempre revisas antes de emitir.»

### 9) Editor y vista previa (2 min)
- **Mostrar:** revisa el borrador (cliente autofill, líneas, IVA/IRPF) y la **vista previa** a la derecha.
- **Se ve:** la vista previa se parece al PDF final (emisor con logo, cliente, tabla, total).
- **Decir:** «Lo que ves aquí es lo que se descargará.» *(Tip: en «Dto. %» borra el 0 y escribe un número —
  ahora se edita con total libertad.)*

### 10) Emitir y PDF (2 min)
- **Mostrar:** **Guardar y emitir** → aparece el **checklist «Revisar antes de emitir»** → confirma → **Descargar PDF**.
- **Se ve:** PDF profesional (logo, datos fiscales del emisor, tabla alineada, total, acentos y €).
- **Decir:** «Numeración automática y correlativa; el número nunca se reutiliza.»

### 11) Papelera y resumen financiero (2 min)
- **Mostrar:** mueve una factura a **Papelera**, **restáurala**; abre **Ver resumen financiero** y cambia el periodo.
- **Se ve:** facturado/cobrado/pendiente/IVA en EUR; gráficos de estado y evolución.
- **Decir:** «Control de cobros e impuestos orientativo para tu gestión (no sustituye a tu asesor fiscal).»

### 12) Configuración de empresa (1 min)
- **Mostrar:** **Configuración → Empresa** (logo, NIF, dirección fiscal).
- **Se ve:** estos datos son los que aparecen como emisor en las facturas.
- **Decir:** «Configuras tu empresa una vez y todas las facturas salen con tu identidad.»

---

## Qué NO debería pasar (si pasa, es un fallo a reportar)
- Ver códigos/UUID, `storage_path`, JSON o errores técnicos en pantalla.
- Que el Asistente diga «no hay» cuando sí hay, invente datos o cree facturas (debe remitir al módulo).
- PDF con «???», «No consta» repetido o sin logo cuando hay logo.
- Sumar monedas distintas en el resumen sin convertir.
- Scroll horizontal raro o zoom automático en móvil.

> Reporta cualquier incidencia siguiendo `docs/VALIDATOR_QA_CHECKLIST.md`.
