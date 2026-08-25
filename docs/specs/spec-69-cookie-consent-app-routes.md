# Spec-69: El banner de cookies tapa la barra de acciones móvil

> **Related:** [spec-62](spec-62-reception-mobile.md) (donde se detectó), [spec-61](spec-61-pickup-route-crew.md) (rutas `/app/*`)

**Status:** in progress

_Date: 2026-08-25_

---

## Goal

Que el banner de consentimiento deje de cubrir los controles primarios de las
pantallas móviles de operación, sin perder la cobertura legal que el banner
existe para dar.

## El hallazgo

`apps/frontend/src/components/Cookies.tsx` se ancla al borde inferior de la
ventana:

```
fixed bottom-0 left-0 right-0 … z-50
```

y está montado en el layout **raíz** (`apps/frontend/src/app/layout.tsx`), así
que se renderiza en **todas** las rutas — incluida la app de operación en
`/app/*`, no sólo las páginas públicas. Aparece con un `setTimeout` de 1 s
cuando no existe la cookie de consentimiento.

La barra de pestañas móvil se ancla al mismo borde, pero más abajo en la pila:

```
fixed inset-x-0 bottom-0 z-30 h-[var(--mobile-tabbar-h)]   (MobileTabBar.tsx:50)
```

`z-50` contra `z-30`: en un teléfono el banner queda **encima** de la barra de
pestañas y, en Recepción, encima de los botones de acción del pie — “Escanear
QR” y “Recibir sin QR” (spec-62 3i). Son los controles primarios de la
pantalla, y caen exactamente donde aterriza el banner.

## Por qué importa

El operario en el andén, con guantes y un teléfono con reflejo, apunta al botón
grande de abajo. Durante el primer segundo largo de su sesión ese botón está
tapado por un banner que no espera y que, en un dispositivo recién entregado o
tras limpiar los datos del sitio, vuelve a aparecer.

No hay reportes de terreno porque **los dispositivos de QA ya tienen la cookie
puesta**: el problema es invisible justo para quienes lo probarían.

## Cómo se detectó

En el E2E móvil de spec-62. El helper de `signIn` pulsa “Aceptar”, pero el
banner sale con 1 s de retraso, así que el clic corría contra el temporizador y
los clics posteriores sobre la barra de acciones impactaban en el banner.

Se resolvió con `suppressCookieBanner()` (`e2e/support/spec52-fixture.ts`), que
escribe la cookie de consentimiento antes de cargar la página. **Eso arregla el
test, no el producto**: el operario real sigue viendo el solape.

## Hallazgo mayor (2026-08-25, al abrir el spec)

Auditando **qué** cookies se fijan —no sólo cuáles se muestran— aparecieron dos
cosas peores que el solape:

**1. El banner no controla nada.** `handleDecline` escribe
`cookie-accept=declined` y oculta el banner; **nadie lee ese valor**. Google
Analytics se monta sin condición en el layout raíz:

```tsx
{ gaID && ( <GoogleAnalytics gaId={gaID}/> ) }
```

Sin comprobación de consentimiento y sin *gtag consent mode*. GA carga y fija
`_ga`/`_gid` tanto si el usuario acepta como si rechaza. El banner es
decorativo: pide un consentimiento que no se honra.

**2. GA corre también en `/app/*`**, por el mismo motivo que el banner: está en
el layout raíz. Así que las pantallas de andén fijan cookies de analítica, que
no son estrictamente necesarias.

Esto **invalida la recomendación original** de este spec. "No renderizar el
banner en `/app/*`" a secas habría quitado el aviso dejando las cookies de
analítica puestas — peor que el estado actual. Hay que arreglar lo que **se
fija**, no sólo lo que **se muestra**.

## Decisiones (2026-08-25, del usuario)

1. **La analítica es sólo de páginas públicas.** Ni GA ni Vercel Analytics en
   las áreas internas autenticadas. Entonces esas rutas fijan sólo cookies
   estrictamente necesarias (sesión Supabase, `remember_me`, tema), no hace
   falta pedir consentimiento ahí, y **el solape desaparece como efecto
   secundario** en vez de administrarse con `z-index`.
2. **El consentimiento pasa a ser real** y entra en este spec: Aceptar y
   Rechazar deben gobernar de verdad la carga de GA.

> **Áreas internas = `/app/*` y `/admin/*`.** El usuario dijo `/app/*`; se
> incluye `/admin/*` porque es igualmente una herramienta interna autenticada y
> el mismo razonamiento aplica. Queda dicho aquí por si se quiere acotar.

Públicas, donde el banner sigue vivo y **ahora sí manda**: `(landing)`,
`legal`, `auth`, `offline`.

## Las opciones que se evaluaron (histórico)

Es una cuestión de cumplimiento antes que de estilos. Tres caminos:

1. **No renderizar el banner en `/app/*`.** La app de operación es una
   herramienta interna autenticada, no web pública; el consentimiento
   posiblemente no aplique ahí. Elimina el choque de raíz en vez de negociar
   `z-index` para siempre. Requiere confirmar la postura legal y qué cookies se
   fijan realmente en esas rutas.
2. **Mantenerlo y reordenar la pila:** subir la barra de pestañas por encima
   del banner e insetar el banner para que no cubra la barra de acciones.
   Conserva la cobertura, pero deja dos elementos disputándose el borde inferior.
3. **Mantenerlo en todas partes pero no bloqueante:** en móvil, una franja
   compacta arriba en lugar de una hoja abajo.

**Recomendación:** la opción 1, si la posición legal lo permite. Las otras dos
conservan el conflicto y lo administran.

> Sin esa decisión no se puede escribir el plan: cada camino toca archivos
> distintos (montaje del layout vs. tokens de `z-index` vs. rediseño del banner).

## Alcance

- `apps/frontend/src/components/Cookies.tsx`
- `apps/frontend/src/app/layout.tsx` (punto de montaje)
- `apps/frontend/src/components/MobileTabBar.tsx` (sólo si se elige la opción 2)
- Retirar `suppressCookieBanner()` del E2E **sólo** si la opción elegida hace que
  el banner ya no aparezca en `/app/*`; si sigue apareciendo, el helper sigue
  siendo legítimo.

## No-goals

- No es una auditoría de qué cookies fija la aplicación ni de su base legal.
- No toca el consentimiento en las páginas públicas.
- No cambia el diseño visual del banner salvo que se elija la opción 3.

## Verificación

El caso que hay que reproducir es el del **dispositivo limpio**, porque es el
único en el que el bug existe:

1. Perfil nuevo o datos del sitio borrados (la cookie de consentimiento ausente).
2. Entrar como `ops_leader` en un viewport de teléfono (390×844).
3. Ir a `/app/reception`.
4. Durante los primeros ~2 s, comprobar que “Escanear QR” es pulsable y que
   nada lo cubre.

Un test que no borre la cookie primero pasa siempre y no prueba nada.

---

## Plan de implementación (TDD)

> **Convención:** comentarios y nombres de test en **inglés**. Los fragmentos en
> español de este plan son prosa explicativa.

### Task 1 — `SiteAnalytics`, un único punto que decide

**Files:** crear `apps/frontend/src/components/SiteAnalytics.tsx`
**Test:** `apps/frontend/src/components/SiteAnalytics.test.tsx`

Un componente cliente que reemplaza los tres montajes sueltos del layout raíz
(`<Analytics/>`, `<CookieConsent/>`, `<GoogleAnalytics/>`). Concentra la
decisión en un sitio; repartida entre tres montajes es como se llegó a este
estado.

```tsx
const INTERNAL_PREFIXES = ['/app', '/admin'];
```

Reglas:
- Ruta interna → no renderiza **nada**: ni GA, ni Vercel Analytics, ni banner.
- Ruta pública → banner siempre; `<Analytics/>` siempre (Vercel Web Analytics
  no usa cookies); **GA sólo si el consentimiento es `accepted`**.
- Aceptar debe encender GA **sin recargar**: el estado de consentimiento vive en
  este componente y `CookieConsent` lo notifica.

Tests (cada uno debe fallar antes):
- ruta interna: no hay banner y no hay GA
- pública sin cookie: hay banner, no hay GA
- pública con `accepted`: hay GA
- pública con `declined`: **no** hay GA ← la que hoy fallaría
- pulsar Aceptar monta GA sin recargar
- `/application` NO cuenta como interna (prefijo mal comparado)

### Task 2 — `CookieConsent` informa su decisión

**Files:** `apps/frontend/src/components/Cookies.tsx`

Añadir `onDecision?: (v: 'accepted' | 'declined') => void`, invocado en ambos
manejadores. No cambia el aspecto del banner.

### Task 3 — Layout raíz delega

**Files:** `apps/frontend/src/app/layout.tsx`

Quitar los tres montajes y dejar `<SiteAnalytics gaId={gaID} />`. El layout es
un servidor; `SiteAnalytics` es cliente porque necesita `usePathname`.

### Task 4 — E2E: retirar el parche

**Files:** `apps/frontend/e2e/support/spec52-fixture.ts`

`suppressCookieBanner()` existía porque el banner tapaba la barra de acciones en
`/app/*`. Si el banner ya no se renderiza ahí, el helper deja de tener sentido y
se retira; si algún test público lo necesita, se conserva sólo ahí.

### Verificación

El caso real es el **dispositivo limpio**, el único donde el bug existe:

1. Perfil nuevo (sin `cookie-accept`), viewport 390×844.
2. `/app/reception` como `ops_leader`: “Escanear QR” pulsable desde el primer
   instante, sin banner encima.
3. Una pública (`/legal`): banner presente; con `declined`, **no** hay `_ga`.

Un test que no borre la cookie antes pasa siempre y no prueba nada.

### No-goals

- No se audita la base legal ni el inventario completo de cookies.
- No se rediseña el banner.
- No se toca Sentry (no fija cookies de seguimiento en esta configuración).
