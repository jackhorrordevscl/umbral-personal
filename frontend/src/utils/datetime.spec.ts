import { describe, it, expect } from 'vitest'
import {
  toChileDayKey,
  chileMonthGridRange,
  groupSlotsByChileDay,
  formatSlotTimeRange,
} from './datetime'

// PR4 (session-calendar-view, tasks 5.1): estos helpers alimentan el
// bucketing del grid mensual (groupByChileDay en CalendarPage) y el rango
// de fetch (chileMonthGridRange -> GET /consultations/range). Los boundaries
// DST usados abajo (spring-forward 2026-09-06T04:00:00Z, fall-back
// 2026-04-05T03:00:00Z) fueron derivados empíricamente en PR1 vía Intl ICU
// (ver apply-progress.md "Key Discovery" del batch PR1) -- se reutilizan acá
// tal cual, no se re-derivan a mano.

describe('toChileDayKey', () => {
  it('bucketea un instante UTC en el día calendario de Chile, no el día UTC naive', () => {
    // 2026-08-16T02:30:00Z en Chile (agosto, -04:00) es 2026-08-15T22:30:00 --
    // un día calendario ANTES que si se tomara el día UTC directamente.
    expect(toChileDayKey('2026-08-16T02:30:00.000Z')).toBe('2026-08-15')
  })

  it('cruza al día siguiente exactamente en el instante de spring-forward (2026-09-06T04:00:00Z)', () => {
    // Justo antes de la transición, Chile sigue en -04:00.
    expect(toChileDayKey('2026-09-06T03:59:00.000Z')).toBe('2026-09-05')
    // Desde ese instante en adelante, Chile pasa a -03:00.
    expect(toChileDayKey('2026-09-06T04:00:00.000Z')).toBe('2026-09-06')
  })

  it('cruza al día siguiente exactamente en el instante de fall-back (2026-04-05T03:00:00Z)', () => {
    // Justo antes de la transición, Chile sigue en -03:00 (horario de verano).
    expect(toChileDayKey('2026-04-05T02:59:00.000Z')).toBe('2026-04-04')
    // Desde ese instante en adelante, Chile vuelve a -04:00.
    expect(toChileDayKey('2026-04-05T04:00:00.000Z')).toBe('2026-04-05')
  })
})

describe('chileMonthGridRange', () => {
  it('septiembre 2026: grid de 42 celdas con spillover de agosto (31/08) y octubre (11/10), rango half-open cruza el spring-forward', () => {
    const grid = chileMonthGridRange(2026, 9)

    expect(grid.days).toHaveLength(42)
    expect(grid.days[0]).toBe('2026-08-31')
    expect(grid.days[41]).toBe('2026-10-11')
    // 31/08 todavía en horario de invierno (-04:00); 12/10 (borde exclusivo)
    // ya en horario de verano (-03:00) -- el propio rango cruza el DST.
    expect(grid.from).toBe('2026-08-31T00:00:00-04:00')
    expect(grid.to).toBe('2026-10-12T00:00:00-03:00')
  })

  it('abril 2026 (triangulación, mes distinto): grid con spillover de marzo y mayo, rango cruza el fall-back', () => {
    const grid = chileMonthGridRange(2026, 4)

    expect(grid.days).toHaveLength(42)
    expect(grid.days[0]).toBe('2026-03-30')
    expect(grid.days[41]).toBe('2026-05-10')
    // 30/03 todavía en horario de verano (-03:00); 11/05 (borde exclusivo)
    // ya en horario de invierno (-04:00).
    expect(grid.from).toBe('2026-03-30T00:00:00-03:00')
    expect(grid.to).toBe('2026-05-11T00:00:00-04:00')
  })
})

// PR5 (patient-self-scheduling, tasks.md 5.1): helpers de display para el
// slot picker de la agenda pública -- reutilizan toChileDayKey/formatChileTime
// en vez de reimplementar la conversión de zona horaria (no duplican la
// lógica de utils/availability.ts de PR4, que resuelve un problema distinto:
// minutos<->"HH:MM" de la grilla semanal del terapeuta, no slots ISO).
describe('groupSlotsByChileDay', () => {
  it('agrupa slots por día calendario de Chile según su instante start', () => {
    const slots = [
      { start: '2026-08-16T02:30:00.000Z', end: '2026-08-16T03:20:00.000Z' }, // 2026-08-15 en Chile
      { start: '2026-08-16T14:00:00.000Z', end: '2026-08-16T14:50:00.000Z' }, // 2026-08-16 en Chile
    ]
    const grouped = groupSlotsByChileDay(slots)

    expect(Object.keys(grouped).sort()).toEqual(['2026-08-15', '2026-08-16'])
    expect(grouped['2026-08-15']).toHaveLength(1)
    expect(grouped['2026-08-16']).toHaveLength(1)
  })

  it('conserva varios slots del mismo día en un solo bucket, en orden', () => {
    const slots = [
      { start: '2026-08-16T13:00:00.000Z', end: '2026-08-16T13:50:00.000Z' },
      { start: '2026-08-16T14:00:00.000Z', end: '2026-08-16T14:50:00.000Z' },
    ]
    const grouped = groupSlotsByChileDay(slots)

    expect(grouped['2026-08-16'].map((s) => s.start)).toEqual([
      '2026-08-16T13:00:00.000Z',
      '2026-08-16T14:00:00.000Z',
    ])
  })
})

describe('formatSlotTimeRange', () => {
  it('formatea el rango hora:minuto de un slot en horario de Chile', () => {
    expect(
      formatSlotTimeRange('2026-08-16T13:00:00.000Z', '2026-08-16T13:50:00.000Z'),
    ).toBe('09:00 - 09:50')
  })

  it('triangulación: un rango distinto produce un label distinto', () => {
    expect(
      formatSlotTimeRange('2026-08-16T18:00:00.000Z', '2026-08-16T18:50:00.000Z'),
    ).toBe('14:00 - 14:50')
  })
})
