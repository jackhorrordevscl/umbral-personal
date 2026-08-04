import { describe, it, expect } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { getApiErrorMessage } from './api-error'

function buildAxiosError(overrides: {
  status?: number
  data?: unknown
  noResponse?: boolean
}): AxiosError {
  const error = new AxiosError('Request failed')
  if (!overrides.noResponse) {
    error.response = {
      status: overrides.status ?? 400,
      statusText: 'Bad Request',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: overrides.data,
    }
  }
  return error
}

describe('getApiErrorMessage', () => {
  it('devuelve el message del backend cuando viene en la respuesta', () => {
    const error = buildAxiosError({ data: { message: 'RUT ya registrado' } })
    expect(getApiErrorMessage(error, 'fallback')).toBe('RUT ya registrado')
  })

  it('ignora un message vacío o solo espacios y usa el fallback', () => {
    const error = buildAxiosError({ data: { message: '   ' } })
    expect(getApiErrorMessage(error, 'fallback')).toBe('fallback')
  })

  it('sin response (error de red) devuelve un mensaje de conexión', () => {
    const error = buildAxiosError({ noResponse: true })
    expect(getApiErrorMessage(error, 'fallback')).toBe(
      'No se pudo conectar con el servidor. Intenta nuevamente.',
    )
  })

  it('un error que no es de axios devuelve el fallback', () => {
    expect(getApiErrorMessage(new Error('boom'), 'fallback')).toBe('fallback')
  })
})
