import { describe, expect, it } from 'vitest';
import { MONTH_LABELS, WEEKDAY_LABELS, addMonths } from './booking-calendar';

describe('addMonths', () => {
  it('avanza dentro del mismo año', () => {
    expect(addMonths({ year: 2026, month: 10 }, 1)).toEqual({ year: 2026, month: 11 });
  });

  it('cruza de diciembre a enero del año siguiente', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('retrocede de enero a diciembre del año anterior', () => {
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('soporta saltos de más de un año', () => {
    expect(addMonths({ year: 2026, month: 3 }, 14)).toEqual({ year: 2027, month: 5 });
    expect(addMonths({ year: 2026, month: 3 }, -15)).toEqual({ year: 2024, month: 12 });
  });
});

describe('etiquetas del calendario', () => {
  it('tiene 12 meses y la semana empieza en lunes', () => {
    expect(MONTH_LABELS).toHaveLength(12);
    expect(WEEKDAY_LABELS).toEqual(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
  });
});
