import { z } from 'zod'

// Issue #386: con Content-Security-Policy sin 'unsafe-eval', zod 4 sondea si
// puede compilar validadores con `new Function("")`. El sondeo se captura y
// zod cae a su camino sin JIT, pero el navegador igual registra una violación
// de CSP por cada carga. `jitless` evita el sondeo. Debe importarse antes que
// cualquier módulo que use zod.
z.config({ jitless: true })
