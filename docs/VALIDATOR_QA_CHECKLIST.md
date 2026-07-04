# Guía de validación del CRM (para probar el producto)

> Guía sencilla para probar el CRM como si fueras una inmobiliaria real. No necesitas conocimientos técnicos.
> Tiempo estimado: 20–30 min. Ve marcando cada punto. Al final tienes cómo reportar fallos.

## Antes de empezar
- [ ] Entra con tu cuenta (o la de prueba que te hayan facilitado).
- [ ] Prueba en **ordenador** y también en **móvil** (iPhone Safari o Android Chrome).
- [ ] Si algo se ve raro, haz **captura de pantalla** antes de continuar.

---

## 1. Configuración de tu empresa (Configuración)
- [ ] Entra en **Configuración → Empresa**.
- [ ] Rellena: nombre comercial, teléfono, web, email de contacto.
- [ ] Rellena **Datos fiscales**: NIF/CIF, dirección, CP, ciudad, provincia, país.
- [ ] Sube el **logo** de la empresa.
- [ ] Pulsa **Guardar** y **recarga la página**: los datos y el logo deben seguir ahí.
- **No debería pasar:** que se pierdan los datos al recargar, ni ver textos raros/códigos.

## 2. Clientes
- [ ] Ve a **Clientes** → **Nuevo cliente**. Rellena nombre, email, teléfono, país e idioma.
- [ ] Guarda y abre su **ficha**.
- [ ] En la ficha, pestaña **Documentos**: sube un PDF, descárgalo y bórralo.
- [ ] Usa el **buscador** de clientes.
- **No debería pasar:** que el documento no suba/descargue, ni ver identificadores tipo `a1b2-c3...`.

## 3. Cartera (inmuebles)
- [ ] Ve a **Cartera** → crea un inmueble (tipo, operación, precio, zona, m², habitaciones, baños, estado).
- [ ] Comprueba que aparece como **tarjeta** en el listado y que los filtros funcionan.
- [ ] Abre el inmueble y sube un **documento**.
- **No debería pasar:** precios/medidas mal formateados, ni scroll horizontal en móvil.

## 4. Calendario
- [ ] Crea una **cita** y edítala.
- [ ] Mira **próximas citas** / agenda (en móvil también).
- **No debería pasar:** que el teclado tape el botón de guardar en móvil.

## 5. Asistente IA
- [ ] Pregunta: **«¿qué pisos tengo en venta hasta 300.000 €?»** → debe listar inmuebles reales.
- [ ] Pregunta: **«busco algo entre 200 y 250 mil»** → debe filtrar por ese rango.
- [ ] Pregunta por un **cliente** por su nombre → debe resumir sus datos.
- [ ] Pregunta por **próximas citas** y **tareas**.
- [ ] Pide **«prepara una factura para Juan»** → debe remitirte al **módulo Facturación** (no la crea el bot).
- **No debería pasar:** que muestre códigos/UUID, que diga «no hay» cuando sí hay, ni que invente datos.

## 6. Facturación (Módulos extra → Facturación)
- [ ] **Crear con texto:** escribe «Factura a [cliente] por comisión de 1.200 € + IVA, vencimiento en 15 días»
      → revisa la **propuesta** (cliente, importe, IVA detectados).
- [ ] Comprueba el **cliente autofill** (sus datos aparecen en «Facturar a»).
- [ ] Cambia la **moneda** a USD → aparece el bloque de **tipo de cambio** (no deja emitir sin él).
- [ ] Pulsa **Guardar y emitir** → aparece el **checklist «Revisar antes de emitir»** → confirma.
- [ ] **Descarga el PDF** y ábrelo: logo, emisor, cliente, tabla, total, acentos y € correctos.
- [ ] En **Papelera**: mueve una factura, restáurala y prueba **eliminar definitivamente** (pide escribir
      «ELIMINAR»).
- [ ] Abre **Ver resumen financiero** y cambia el periodo (mes/trimestre/año).
- **No debería pasar:** sumar monedas distintas, PDF con «???» o «No consta» por todas partes, emitir sin
      cliente o sin importe.

## 6b. Comisiones — flujo por estados (P46)
- [ ] En **Cartera → Comisiones** ves arriba el bloque **«Qué falta por hacer»** con el recuento (o «Todo al día»).
- [ ] Las pestañas **Por hacer / Facturadas / Cobradas / Potenciales / Todas** filtran la lista.
- [ ] Cada fila muestra **un solo botón principal** según su estado (Crear factura / Abrir factura / Ver factura…), una explicación corta y el paso del ciclo («Paso 2 de 3»).
- [ ] Una comisión **cobrada internamente sin factura** muestra «Cobrada sin factura» y el botón **«Crear factura del cobro»** (no «Crear factura» a secas).
- [ ] **No** aparece «Marcar pendiente» como botón; «Deshacer cobro interno» está en el menú **«Más» (⋯)** con confirmación.
- [ ] Tras **emitir** una factura desde una comisión, esa operación deja «Pendiente de facturar» y pasa a **«Facturadas»**; al marcarla **cobrada**, pasa a **«Cobradas»** con chip verde «Cerrado».
- [ ] El botón **«¿Cómo funciona?»** abre una guía breve del ciclo.
- **No debería pasar:** ver una operación ya facturada como «pendiente de facturar», ni «Crear factura» cuando ya hay factura.

## 7. Móvil (repite lo esencial en el teléfono)
- [ ] Menú lateral (drawer) se abre/cierra bien.
- [ ] Formularios **no hacen zoom** al tocar un campo.
- [ ] No hay **scroll horizontal** raro.
- [ ] El **editor de factura** alterna «Editar / Vista previa».
- [ ] La **descarga del PDF** funciona.

---

## Cómo reportar un fallo
Para cada problema, envía:
1. **Qué hacías** (ruta + acción, ej. «Facturación → emitir factura»).
2. **Qué esperabas** y **qué pasó**.
3. **Captura de pantalla** (o vídeo corto).
4. **Dispositivo** (ordenador / iPhone / Android) y **navegador**.

> Consejo: si ves un texto técnico (código, UUID, «error 500», SQL), cópialo tal cual en el reporte.
