import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import './zod-config'

describe('zod-config', () => {
  it('desactiva el JIT de zod para no necesitar unsafe-eval en la CSP', () => {
    expect(z.config().jitless).toBe(true)
  })

  it('sigue validando con el JIT desactivado', () => {
    const schema = z.object({ email: z.string().email() })
    expect(schema.safeParse({ email: 'a@b.cl' }).success).toBe(true)
    expect(schema.safeParse({ email: 'no-es-email' }).success).toBe(false)
  })
})
