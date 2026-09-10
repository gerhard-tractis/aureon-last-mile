# Recogida — lo que la implementación aprendió y el mock todavía no sabe

**Para:** quien mantiene `Recogida.dc.html` en Claude Design (proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`).
**Fecha:** 2026-09-10.
**Contra qué se comparó:** `docs/design/Recogida.dc.html` (copia versionada, artboards `5a`–`5i`) frente a QA (`qa.aureon.tractis.ai`) con `admin@musan.com`, recorriendo el flujo real: abrir ruta → escanear → cerrar con faltantes → firma → cámara.

Esto **no** es una lista de bugs ni una petición de cambios al código. Es lo contrario: durante la implementación aparecieron capacidades, restricciones y ambigüedades que el mock no podía prever. Se escriben aquí para que la siguiente ronda de diseño las incorpore.

La regla de desempate vigente sigue siendo la de `docs/design/README.md`: **el mock manda en diseño, el spec manda en comportamiento.** Nada de lo que sigue la cambia.

Cada punto dice si es (**A**) algo construido que el mock no dibuja, (**B**) algo que el mock pide y está deliberadamente aplazado, o (**C**) una ambigüedad del propio mock que hay que resolver en diseño.

---

## 5a — Escritorio

**(A) La barra superior de la app ya tiene un buscador global** de orden/paquete/RUT, más el conmutador Claro/Oscuro y el avatar. El mock pone el buscador **del módulo** en esa misma cabecera (`5a:58-64`); el código lo pone en una barra ancha bajo los `StatTile`. Hoy conviven dos buscadores distintos. Hay que decidir en diseño cuál vive dónde — `spec-83` fase 4 dejó el punto declarado y sin revisar.

**(A) La tabla tiene una séptima columna** (impresión de etiquetas, `spec-53`) que el mock no dibuja. `spec-83` fase 4 la conservó explícitamente. El mock debería incluirla.

**(A) El vehículo no se elige inline.** El mock muestra un panel `VEHÍCULO Y CONDUCTOR` con el vehículo ya elegido y un «Cambiar», dentro de la ruta en armado. La implementación (`spec-61`) lo elige en un **diálogo modal al confirmar**, y **no hay conductor que elegir**: lo asigna quien lidera la ruta. `spec-83` fase 4 lo declaró como *modelo de interacción distinto*, no como dato faltante. El panel del mock no tiene contraparte posible sin rehacer el flujo de creación de ruta.

**(A) El CTA real es «Iniciar ruta de retiro»**, no «Crear ruta y generar QR». El QR existe, pero en su propia pantalla (`/app/pickup/route/[routeId]/qr`). Si el mock quiere que crear la ruta salte al QR, eso es una decisión de flujo que hay que declarar.

**(B) Barra de «Ocupación estimada 68%».** `spec-83` fase 3 está `[parked]` por decisión del usuario (2026-09-09), textual: «No hay capacity para esto ahora, y no es bloqueante para el rollout con tenant. Se retoma cuando el rollout lo pida.» **No está descartada** — se retoma en ese mismo spec. El mock puede conservarla; sólo conviene saber que hoy no hay capacidad de vehículo ni volumen de paquete con los que calcularla, y que inventar un porcentaje se descartó a propósito.

**(B) Pie de paginación** (`5a:202-208`, «7 de 12 · página 1 de 2» + Anterior/Siguiente). No existe paginación en ningún componente de Recogida escritorio. `spec-83` fase 4 lo dejó declarado como comportamiento nuevo, no como ajuste visual. Vale la pena confirmar en diseño si de verdad se quiere paginar o si la lista debe crecer.

**(C) Los chips de cliente del mock llevan conteos** (`Todos · 12`, `Falabella · 4`) y una etiqueta `CLIENTE` delante. `ClientFilter.tsx` no renderiza ninguna de las dos cosas, y su pastilla activa es `bg-accent` sólida mientras la del mock es neutra/elevada. Es barato de alinear, pero hay que decir cuál gana: el conteo por cliente es información real y útil.

---

## 5b — Móvil, sin ruta activa

**(A) Existe un bloque `ACOMPAÑANTES`** — la cuadrilla que sube a la ruta, con casillas por persona (`spec-61`). El mock no lo dibuja, y cambia la altura de esa tarjeta de forma sustancial. Es lo más grande que le falta a `5b`.

**(B) «MANIFIESTOS ASIGNADOS A TI · 4».** Hoy el eyebrow dice «MANIFIESTOS POR RETIRAR» a propósito. `manifests.assigned_to_user_id` existe pero nada lo escribe; `spec-82` decidió que implementar el texto literal del mock **congelaría una mentira en la UI** en cuanto haya dos cuadrillas. La decisión de producto ya se tomó (usuario, 2026-09-09): «El líder de recogida define la asignación. Al llegar al punto de retiro recibe los manifiestos, y en ese momento los asigna.» La fase que lo entrega sigue `[parked]`. El texto del mock es correcto **a futuro**; conviene anotarlo como tal.

**(C) El selector de vehículo del mock muestra una patente ya elegida** (`JKLM-42`, con ícono de camión y chevron). El control real es un combobox con placeholder «Patente» y sin ícono. El mock implica una preselección que no existe — ¿debería existir?

**(C) El título.** `5b` se titula «Recogida»; `5c` se titula «Recogidas de hoy». La app usa «Recogidas de hoy» en **ambos** estados. Si el cambio de título entre los dos estados es intencional en el diseño, hay que decirlo, porque hoy no se distingue.

**(C) Lado de la casilla.** En el mock, la casilla de la fila de carga va a la **derecha**, igual que la del grupo de cliente. En la app, la del grupo va a la derecha y la de la carga a la **izquierda**. Probablemente sea un descuido de uno de los dos lados.

---

## 5c — Móvil, ruta activa

La pantalla con más distancia entre mock y código. Tres cosas construidas que el mock no prevé:

**(A) Tarjeta de estado de ruta.** Código de ruta, `0/28`, barra de progreso y tres cifras (`VERIFICADOS` / `RESTAN` / `MANIFIESTOS`). `spec-82` fase 1 la conservó por escrito: es «más rica que la pastilla compacta del mock». El mock debería absorberla en vez de al revés.

**(A) Panel de mapa con «Abrir navegación».** No tiene ninguna contraparte en `5c`. Hay que ubicarlo en diseño.

**(A) `Cancelar ruta`.** `spec-82` fase 1, textual: «no tiene contraparte en el mock». Es una capacidad real (`spec-61` Task 5 — la salida para una ruta que no debió abrirse). Choca de frente con el pie del mock: el mock pone ahí `Buscar` + `Digitalizar manifiesto`, y la app pone `Cerrar ruta` + `Cancelar ruta`, con `Cerrar ruta` arriba en el mock. **La barra inferior de `5c` necesita un rediseño que acomode los cuatro controles.** Es la decisión de diseño más urgente de este documento.

**(A) `Ver el manifiesto` y un botón `+`**, tampoco en el mock.

**(C) El CTA de la carga siguiente** dice «Verificar»; el mock dice «Iniciar recogida» con ícono de código de barras. Hay que elegir uno.

**(C) — y esto es lo más valioso — el chip `EN RUTA` de la cabecera de grupo no es implementable como está.** `spec-82` fase 1 lo verificó leyendo las cuatro cabeceras del mock una junto a otra:

| Grupo | Qué lleva en el mismo slot |
|---|---|
| Falabella | chip `EN RUTA` |
| Ripley | **nada** |
| Paris | un botón «Ver carga» |
| Sodimac | chip `COMPLETADA` |

Cuatro grupos, cuatro cosas distintas en el mismo sitio — y **Ripley está tan «en ruta» como Falabella**: ambos tienen cargas activas sin completar. No hay predicado derivable de los datos que reconstruya la distinción sin inventar una regla que el mock no declara. Agrupar por cliente es barato (`retailer_name` ya viaja en `RouteManifestRow`); lo que falta es la **definición**. Hace falta que el diseño diga cuándo un grupo lleva chip, cuál, y cuándo lleva un botón en su lugar.

**(B) «· andén P2» en la tarjeta.** `spec-82` fase 4 está `[blocked]`, pero no por esquema: `pickup_locations` ya admite el campo y añadir `dock` es cero migración. Lo que falta es decidir si el alta del punto de recogida **captura** el andén. Es una pregunta de diseño de formulario, no de base de datos.

---

## 5d — Escaneo

**(A) La pantalla real es bastante más grande que el mock.** Además de lo que `5d` dibuja, tiene: miga de pan (`Recogida › Escaneo › Revisión › Firma`), botón «Imprimir etiquetas» (`spec-53`), un temporizador de sesión, y **la lista completa de órdenes y bultos de la carga**, expandible, con conteo `n/m` por orden y una acción por bulto. Esa lista es cómo el operario ve qué le falta. El mock no la tiene y es lo que más ocupa la pantalla.

**(C) Los tres botones del pie del mock asumen un gesto que el hardware no hace.** `Escanear siguiente` implica tocar para escanear. El lector de QA es una pistola que **teclea** el código y no manda Enter — por eso la app tiene un campo de escaneo siempre enfocado (`ScanField`/`useScannerAutoSubmit`) en vez de un botón. `Ingresar código` sigue teniendo sentido como salida manual; `Escanear siguiente` probablemente no. La app resuelve el pie con un único «Continuar a revisión».

**(A) La tarjeta «Paquete verificado» sí coincide** — ícono, título, tracking en mono, orden, dirección y «paquete N de M». Es el mejor calce del móvil junto con `5g`. El `HISTORIAL DE ESCANEOS` (punto de color + código + hora, fila roja para `NO ESTÁ EN LA CARGA`) también coincide.

---

## 5e — Cerrar con faltantes

**Calce casi exacto.** El aviso rojo, su copy literal, `SIN VERIFICAR · n`, los chips `Nota` y los dos botones del pie están tal cual. No hay nada que devolverle al diseño aquí.

Lo único no verificado: el estado `CON NOTA` (con la nota citada inline) y la sección `NO ESTABAN EN LA CARGA · 1`, porque el recorrido de QA no generó ninguna nota ni ningún escaneo ajeno.

---

## 5f — Firma

**(A) Hay una rejilla de cuatro cifras** — `VERIFICADOS`, `FALTANTES (CON NOTA)`, `PRECISIÓN`, `DURACIÓN` — donde el mock pone una sola línea de resumen («39 verificados · 3 faltantes · 1 ajeno»). Las dos formas transmiten lo mismo; hay que elegir.

**(A) Hay una tarjeta de aviso legal**, «Aviso de transferencia de custodia», que el mock no dibuja. Es texto de responsabilidad, no decorativo — no se puede omitir sin una decisión.

**(A) La firma del local es opcional, detrás de una casilla** «Agregar firma del cliente»; el mock dibuja el lienzo y el campo «Nombre» directamente. `spec-80` fase 3 reordenó las dos secciones al orden del mock (local primero, operador después) pero **conservó la casilla existente**. El mock presenta como esperado algo que hoy es opt-in.

**(A) «TU FIRMA» no pide nombre**: muestra `Operador: <nombre de sesión>` y etiqueta el lienzo «Firma del operador (obligatoria)». El mock pone un campo «Nombre» editable en ambas firmas.

**(A) El título es «Firma y finalización»** bajo el código de carga; el mock titula «Cerrar CARGA-99814».

**(A) Al confirmar aparece un diálogo** «¿Confirmar transferencia de custodia? … Esta acción es irreversible» que el mock no prevé.

**(C) La leyenda ámbar «Todo queda en el teléfono…» se muestra siempre**, también con señal. En el mock aparece en un estado `SIN RED`. Conviene decidir si es condicional. Nota relacionada: `spec-80` fase 3 (ronda 2) dejó documentado que la promesa «Las fotos también» sólo será completa cuando aterrice `spec-81` fase 5.

**(C) El CTA del mock lleva un ✓** delante de «Confirmar y cerrar carga»; el real no.

---

## 5g — Cámara

**Calce casi pixel a pixel.** Título «Hoja N de CARGA-…», subtítulo, esquinas de encuadre, la instrucción «Encuadra la hoja completa, con la firma visible», `YA CAPTURADAS · n`, obturador y «Listo»: todo está.

**(C) Lo único que falta es el botón de flash (⚡)** que el mock pone arriba a la derecha. Para fotografiar un papel firmado en una bodega, probablemente importe.

---

## 5h y 5i — no verificados

- **`5h`** (revisar la foto antes de guardarla) necesita una captura real de cámara; no se puede alcanzar desde un navegador headless.
- **`5i`** (carga cerrada) se dejó sin verificar a propósito: llegar exige confirmar el diálogo irreversible de transferencia de custodia, que habría consumido el fixture de QA.

Ninguno de los dos tiene hallazgos ni a favor ni en contra. Quedan pendientes.

---

## Lo que NO es para diseño

Encontrado en el mismo recorrido; se anota aquí sólo para que no se confunda con feedback de mock. **Son defectos de la app.**

1. **Textos en inglés en una UI en español**, cuatro, todos hardcodeados:
   - `components/pickup/ScanHistoryList.tsx:43` — `'No scans yet'`
   - `components/pickup/ScannerInput.tsx:83` — `placeholder="Scan barcode..."`
   - `components/pickup/ManifestDetailList.tsx:54` — `Orders & Packages`, y `:57` — `{n}/{m} verified`
   - `components/pickup/PackageRow.tsx:150` — `Mark Verified`
2. **La etiqueta `FALTANTES (CON NOTA)` se corta** en su tarjeta de `5f`.
3. **`TodayClosuresPanel` tiñe la fila completa** cuando hay merma; el mock (`5a:264-268`) sólo tiñe el badge del ícono. Ya está declarado como hallazgo abierto en `spec-83` fase 4 — el mock gana, pero no se aplicó para no romper el test de la fase 1.

---

## Cómo se refresca este documento

Se compara contra la copia versionada del mock, no contra el proyecto remoto. Si el diseño cambia, primero se baja de nuevo `Recogida.dc.html` (ver `docs/design/README.md`) y después se revisa este archivo. Un punto resuelto se borra; no se marca como hecho.
