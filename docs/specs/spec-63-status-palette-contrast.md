# Spec-63: Contraste no textual de la paleta de estado

> **Related:** [spec-54](spec-54-ui-rebrand.md) (define la paleta y la regla de dos canales), [spec-62](spec-62-reception-mobile.md) (donde se detectó)

**Status:** completed

_Date: 2026-08-21_

---

## Goal

Llevar los chips de estado —los cuadros de color que llevan un glifo blanco— por
encima del 3:1 que exige WCAG 1.4.11 para elementos no textuales, sin romper la
identidad de la paleta ni la regla de dos canales.

## El hallazgo

Detectado revisando el tono `warn` del bloque de resultado de escaneo en spec-62
(fase 1, task 2). Las mediciones, glifo blanco sobre el color sólido del chip:

| Token | Claro | ¿3:1? | Oscuro | ¿3:1? |
|---|---|---|---|---|
| `--color-status-warning` | `#f59e0b` 2.15:1 | ❌ | `#fbbf24` 1.67:1 | ❌ |
| `--color-status-success` | `#10b981` 2.54:1 | ❌ | `#4ade80` 1.74:1 | ❌ |
| `--color-status-error`   | `#ef4444` 3.76:1 | ✅ | `#f87171` 2.77:1 | ❌ |
| `--color-status-info`    | `#3b82f6` 3.68:1 | ✅ | `#60a5fa` 2.54:1 | ❌ |

Ninguno lo introdujo spec-62: success y error ya estaban desplegados. El tono
`warn` es nuevo, y quedó como el peor de los tres.

> **Corrección (2026-08-24, al abrir el spec).** La tabla original medía **solo
> el tema claro** y daba `error` por aprobado. Medido el tema oscuro, **fallan
> los cuatro**, `error` e `info` incluidos. El problema es más amplio de lo que
> decía el hallazgo, no menos.

## Por qué importa más que un número de auditoría

La regla de diseño de spec-54 dice que **cada estado se codifica por dos canales,
color y forma**, para que sobreviva a la visión daltónica y a una foto en escala
de grises. El glifo *es* el segundo canal. Un glifo que no contrasta con su
propio fondo degrada el canal del que depende toda la regla: en un andén, con
luz de galpón y una pantalla con reflejo, el operario se queda solo con el color
— exactamente lo que la regla existía para evitar.

## Alcance

- Los tres pares de `--color-status-*` en `globals.css` (claro y oscuro).
- Todo consumidor del chip sólido con glifo blanco: `ScanResult`, `StatusBadge`,
  las tarjetas de andén, los badges de la torre, y los que aparezcan al auditar.

### Decisión (2026-08-24): un par de tokens dedicado al chip

Auditados los **184** usos de `bg-status-*`, sólo **dos componentes** ponen un
glifo dentro de un chip sólido: `ScanResult` (3 iconos, con `stroke="#fff"`
hardcodeado) y `ReturnPackageRow` (1). Todo lo demás son puntos, barras y
rellenos de progreso: gráficos que se miden **contra el fondo de la página**,
otro requisito, y que hoy no fallan. El alcance real es mucho menor de lo que
suponía este spec.

Las dos opciones originales quedan descartadas por medición:

- **Opción 1 (oscurecer los tokens sólidos)** arrastra los 184 usos —
  cada punto, barra y píldora de torre, distribución, despacho, recogida y
  recepción— para arreglar 4 sitios.
- **Opción 2 (glifo `-text` sobre `-bg`)** **rompe justamente lo que protege**:
  en `ScanResult` el chip vive dentro de una caja que *ya* es `-bg`, así que el
  cuadro se disolvería en su propio contenedor y se perdería el canal de forma.
- Una tercera vía —glifo oscuro sobre el sólido de hoy— pasa en success y
  warning pero es inalcanzable en error (2.66:1 máx.) e info (2.82:1).

Se adopta un **par de tokens propio del chip**, aplicado sólo donde hay glifo:

| | Chip (fondo) | Glifo |
|---|---|---|
| Claro | `--color-status-*-chip` oscurecido | blanco |
| Oscuro | `--color-status-*-chip` = el brillante de hoy | `--color-status-*-chip-fg` oscuro |

El glifo es un token y no `#fff` porque en oscuro un chip oscuro se perdería
contra su caja: cada tema elige el par que satisface **las dos** restricciones.

Verificado — los 16 pares pasan, glifo (1.4.11) y forma (chip contra su caja):

| Tema | Token | Chip | Glifo | Contraste glifo | Contraste forma |
|---|---|---|---|---|---|
| Claro | success | `#065f46` | blanco | 7.68:1 | 7.29:1 |
| Claro | warning | `#92400e` | blanco | 7.09:1 | 6.84:1 |
| Claro | error   | `#b91c1c` | blanco | 6.47:1 | 5.91:1 |
| Claro | info    | `#1d4ed8` | blanco | 6.70:1 | 5.49:1 |
| Oscuro | success | `#4ade80` | `#052e16` | 8.55:1 | 8.74:1 |
| Oscuro | warning | `#fbbf24` | `#451a03` | 8.97:1 | 9.09:1 |
| Oscuro | error   | `#f87171` | `#450a0a` | 5.84:1 | 5.68:1 |
| Oscuro | info    | `#60a5fa` | `#172554` | 6.00:1 | 5.78:1 |

Los puntos, barras y progreso **no se tocan**: conservan el color de marca.

## No-goals

- No es un rediseño de la paleta ni una revisión de los colores de marca.
- No toca el contraste de **texto** (1.4.3), que es una auditoría distinta.

## Por qué no se arregló en spec-62

Es un cambio transversal: torre, distribución, despacho, recogida y recepción
consumen los mismos tokens. Metido en un PR de recepción móvil habría hecho
irrevisable tanto el cambio de diseño como la pantalla, y habría mezclado dos
motivos de reversión en un solo commit.

---

## Plan de implementación (TDD)

> **Convención:** comentarios de código y nombres de test en **inglés**, como el
> resto del repo. Los fragmentos en español de este plan son prosa explicativa,
> no permiso para escribir tests en español.

### Task 1 — Tokens del chip en `globals.css`

**Files:** `apps/frontend/src/app/globals.css`

Añadir, junto a los `--color-status-*` existentes:

- Claro: `-chip` = `#065f46` / `#92400e` / `#b91c1c` / `#1d4ed8`; `-chip-fg` = `#ffffff`.
- `html.dark`: `-chip` = `#4ade80` / `#fbbf24` / `#f87171` / `#60a5fa`;
  `-chip-fg` = `#052e16` / `#451a03` / `#450a0a` / `#172554`.

Comentario obligatorio explicando **por qué el glifo es un token** (en oscuro un
chip oscuro se perdería contra su caja) — si no, el siguiente que lo lea lo
"simplificará" de vuelta a `#fff`.

### Task 2 — Exponer los tokens a Tailwind

**Files:** `apps/frontend/tailwind.config.ts` (bloque `status`, ~línea 64)

Tailwind 3 mapea a mano: sin esta entrada las clases `bg-status-*-chip` se
compilan a nada y el chip sale **transparente**. Añadir `*-chip` y `*-chip-fg`
para los cuatro estados.

### Task 3 — `ScanResult` usa el chip y hereda el color del glifo

**Files:** `apps/frontend/src/components/scan/ScanResult.tsx`
**Test:** `apps/frontend/src/components/scan/ScanResult.test.tsx`

- [ ] Test que falla: para cada tono (`ok`/`warn`/`error`) el chip lleva
      `bg-status-<tono>-chip` y el glifo **no** lleva `stroke="#fff"`.
- [ ] Cambiar `TONE.*.icon` a `bg-status-*-chip`, y añadir al chip
      `text-status-*-chip-fg`.
- [ ] Los tres `stroke="#fff"` pasan a `stroke="currentColor"` para heredar del
      contenedor. Es el punto del cambio: un `#fff` hardcodeado ignora el tema.
- [ ] Verificar que el test falla si se revierte (mutación), y commit.

### Task 4 — `ReturnPackageRow`

**Files:** `apps/frontend/src/components/reception/ReturnPackageRow.tsx`
**Test:** el `.test.tsx` hermano

- [ ] Test que falla: `pkg-received` lleva `bg-status-success-chip` y
      `text-status-success-chip-fg`, no `text-white`.
- [ ] Aplicar el cambio y commit.

### Task 5 — Test de regresión de contraste

**Files:** `apps/frontend/src/app/globals.contrast.test.ts` (nuevo)

Parsea `globals.css` y calcula el contraste real de cada par `-chip`/`-chip-fg`
en ambos temas, exigiendo ≥3:1. Es la única defensa contra que alguien
"reajuste" un token y vuelva a bajar de 3:1 — un test que mira nombres de clase
no detectaría eso.

### No incluido

Puntos, barras y progreso: son gráficos contra el fondo de la página, otro
requisito (y hoy no fallan). Tocarlos aquí mezclaría dos motivos de reversión.
