# Recogida — lo que la implementación aprendió y el mock todavía no sabe

**Para:** quien mantiene `Recogida.dc.html` en Claude Design (proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`).
**Última revisión:** 2026-09-11, contra la **ronda 2** del mock (`5a`–`5i` más `5f2`).
**Estado del código:** `spec-95` `completed` — las nueve pantallas implementadas y mergeadas, verificadas en QA con `admin@musan.com`.

La ronda 2 cerró casi todo lo que este documento pedía. **Lo resuelto se borró**, no se marcó como hecho: lo que queda es lo que sigue abierto, más lo que aprendimos construyéndola.

Regla de desempate, sin cambios: **el mock manda en diseño, el spec manda en comportamiento.**

---

## 1. Lo más importante: los artboards son más anchos que un teléfono real

**Esto causó un bug que llegó a producción.**

Los artboards móviles miden ~472px. Un teléfono de gama media mide **390px**, y el suelo que este repo soporta es **320px**.

En `5c` el mock dibuja cuatro controles en la fila superior del pie: `Buscar`, `Ver manifiesto`, `Digitalizar`, `+`. Caben en 472px. **No caben en 390px.** Medido en QA:

| Control | Borde derecho | Viewport |
|---|---|---|
| `Digitalizar manifiesto` | 446px | 390px |
| `+` | **498px** | 390px |

`document.scrollWidth` era 390: el navegador **recorta**, no deja hacer scroll. El `+` no se ve y **no se puede tocar** — y es la única forma de agregar un manifiesto a una ruta en curso desde el móvil, así que el operario pierde esa capacidad entera.

No lo atrapó ninguna revisión de código, porque el motor de tests no maqueta. No lo atrapó ningún test E2E, porque no hay ninguno sobre estas pantallas. Lo encontró una persona mirando la pantalla a 390px.

**Lo que pedimos:** que los artboards móviles se dibujen a **390px**, o que lleven anotado el ancho objetivo. Si un control no cabe a 390, es mejor saberlo en el diseño que descubrirlo en la bodega.

---

## 2. `5c` — el chip de Ripley contradice la regla que tú mismo fijaste

La regla A («por progreso») que elegiste es la que está implementada:

- `COMPLETADA` — todas las cargas del grupo cerradas.
- `EN RUTA` — alguna carga con escaneos y sin cerrar.
- `PENDIENTE` — el resto.

Bajo esa regla **Ripley es `PENDIENTE`**: su única carga está sin escanear, marcada `DESCARGAR`. El artboard todavía la dibuja **`EN RUTA`**.

Verificado en QA contra la implementación viva: un grupo con un escaneo lee `EN RUTA`, uno sin tocar lee `PENDIENTE`. Sólo falta corregir esa celda del mock.

---

## 3. `5c` — el plegado de grupos está dibujado y no está construido

La cabecera de grupo del mock lleva un control de plegado (chevron abajo en `EN RUTA`, a la derecha en `PENDIENTE`/`COMPLETADA`), y los grupos que no están en ruta se dibujan **plegados**. No se implementó: la app expande siempre. Plegar es comportamiento nuevo, no un ajuste visual, y no estaba en el encargo de ninguna fase.

**Efecto colateral que el mock oculta:** con los grupos expandidos, un grupo de un solo manifiesto cerrado muestra **dos chips `COMPLETADA`** — uno en la fila y otro en la cabecera. En el mock no se ve porque ese grupo está plegado.

**Decide:** ¿se construye el plegado, o los grupos van siempre expandidos y el mock se redibuja así?

---

## 4. `5c` — «4,2 km · 11 min» no se puede implementar, y no es por presupuesto

Decidiste dejar la cifra fuera y poner sólo dirección y navegación. **Fue la única opción posible**, aunque la razón resultó más dura de lo que ambos creíamos.

Al evaluarlo se ofreció «distancia en línea recta» como alternativa barata, dando por hecho que las coordenadas ya estaban en los datos. **No están.** El comentario de la migración documenta el contrato como `[{name, address, comuna, lat, lng, …}]`, pero el validador del **camino de escritura** no tiene `lat` ni `lng`: nada en la app los escribe nunca.

No hay ruta hacia ninguna distancia —ni recta ni conducida— hasta que el alta del punto de recogida capture coordenadas. **Si esa cifra importa, lo primero que hay que diseñar es el formulario que la hace posible.**

*(En QA, hoy, el panel lee «Mapa no disponible» porque los puntos de recogida tampoco tienen dirección cargada. El comportamiento es correcto: sin dato no se pinta un botón de navegación muerto.)*

---

## 5. `5a` — «Ver QR de la ruta» no puede vivir en el panel BORRADOR

Lo quitamos; conviene que el mock lo refleje.

En estado BORRADOR **la ruta todavía no existe**, así que «ver su QR» no es una operación posible: lo único que el botón podía hacer era **crearla** — convertir un verbo de lectura en uno de escritura. Y `start_pickup_route` impone **una ruta activa por conductor**: quien sólo quería enseñarle el QR al receptor se quedaba con una ruta abierta cuya única salida es `Cancelar ruta`.

La afordancia correcta **ya existe y funciona** en el banner de ruta activa — que es donde tu propio mock también la dibuja, sobre la ruta `R-2492 en curso`. No hace falta duplicarla en el borrador.

---

## 6. Divergencias de formato que siguen abiertas

Ninguna es grave; todas están sin decidir.

**`5d`**
- Bajo «ÓRDENES Y BULTOS» el mock muestra el conteo de **órdenes** («18 órdenes»); el código muestra la **fracción verificada** (`n/m`). Se mantuvo la fracción porque le dice al operario lo que le falta. ¿Cuál quieres?
- El mock dibuja una insignia **`LECTOR LISTO`** junto al campo de escaneo. No se implementó.

**`5f`**
- Los valores van en color en el mock (`VERIFICADOS` verde, `FALTANTES` rojo); el código los pinta en el color de texto normal.
- El mock no lleva iconos en las tarjetas de cifras; el código sí.
- El mock no lleva banda dorada en la cabecera; el código la conserva.
- Título 19px en el mock, 16px en el código.

**`5f2`**
- «Respaldo» dice «2 fotos del manifiesto» en el mock; el código dice «2 fotos», reutilizando el formateador que ya resuelve «sin dato» y «en cola». El sufijo se perdió a propósito.

**`5a`**
- La barra de búsqueda del mock lleva una insignia de atajo `/` que no se implementó.
- Los chips del mock son rectángulos de `border-radius:6px`; el código usa pastillas redondeadas (preexistente).

---

## 7. Sigue aparcado, no olvidado

- **La barra de ocupación estimada (68%) de `5a`.** Decisión tuya del 2026-09-09: «No hay capacity para esto ahora». El mock la conserva a propósito. Construirla exige capacidad del vehículo y volumen del paquete; ninguno existe hoy.
- **El andén en la tarjeta de `5c`** («Mall Plaza Vespucio · andén P2»). No es un problema de esquema —añadir el campo es cero migración—. **La pregunta de diseño sin responder es si el alta del punto de recogida lo captura.**
- **«MANIFIESTOS ASIGNADOS A TI» en `5b`.** La ronda 2 aceptó «MANIFIESTOS POR RETIRAR», que es lo que la app sostiene hoy. La asignación real —el líder asignando al llegar al punto— sigue sin construirse.

---

## 8. Lo que la ronda 2 cerró bien, para que no se vuelva atrás

Dos decisiones tuyas resultaron especialmente valiosas:

- **La regla única del chip de grupo.** La ronda 1 tenía cuatro grupos con cuatro cosas distintas en el mismo slot, y eso bloqueó la implementación durante dos rondas de spec porque no había predicado derivable de los datos. Una regla única lo desbloqueó de inmediato.
- **Que la ronda 2 adoptara lo que la app ya tenía** en vez de pedir que se quitara: la rejilla de cifras y el aviso de custodia de `5f`, la tarjeta de estado de ruta de `5c`, el bloque de cuadrilla de `5b`. Eso convirtió semanas potenciales de rediseño en alineación de copy.

---

## Cómo se refresca este documento

Se compara contra la copia versionada del mock, no contra el proyecto remoto. Si el diseño cambia, primero se baja de nuevo `Recogida.dc.html` (ver `README.md`) y después se revisa este archivo. **Un punto resuelto se borra; no se marca como hecho.**
