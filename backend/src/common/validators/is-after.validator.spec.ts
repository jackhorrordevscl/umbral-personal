import { validate } from 'class-validator';
import { IsAfter } from './is-after.validator';

// sdd/patient-self-scheduling PR 2 (tasks.md 2.5, spec.md "Invalid time range
// is rejected"): validador de cross-field genérico -- lo usan tanto
// ScheduleEntryDto (startMinute/endMinute, number) como CreateBlockoutDto
// (startsAt/endsAt, Date tras @Type(() => Date)).
class NumberRangeFixture {
  start: number;

  @IsAfter('start')
  end: number;
}

class DateRangeFixture {
  start: Date;

  @IsAfter('start')
  end: Date;
}

describe('IsAfter', () => {
  it('acepta cuando el campo es mayor que el campo relacionado (number)', async () => {
    const fixture = new NumberRangeFixture();
    fixture.start = 540; // 09:00
    fixture.end = 780; // 13:00

    const errors = await validate(fixture);

    expect(errors).toHaveLength(0);
  });

  it('rechaza cuando el campo es igual al campo relacionado (number)', async () => {
    const fixture = new NumberRangeFixture();
    fixture.start = 540;
    fixture.end = 540;

    const errors = await validate(fixture);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('end');
  });

  it('rechaza cuando el campo es menor que el campo relacionado (number)', async () => {
    const fixture = new NumberRangeFixture();
    fixture.start = 780;
    fixture.end = 540;

    const errors = await validate(fixture);

    expect(errors).toHaveLength(1);
  });

  // Triangulación: mismo decorador, tipo Date en vez de number.
  it('acepta cuando el campo es posterior al campo relacionado (Date)', async () => {
    const fixture = new DateRangeFixture();
    fixture.start = new Date('2026-06-01T13:00:00.000Z');
    fixture.end = new Date('2026-06-01T14:00:00.000Z');

    const errors = await validate(fixture);

    expect(errors).toHaveLength(0);
  });

  it('rechaza cuando el campo es anterior al campo relacionado (Date)', async () => {
    const fixture = new DateRangeFixture();
    fixture.start = new Date('2026-06-01T14:00:00.000Z');
    fixture.end = new Date('2026-06-01T13:00:00.000Z');

    const errors = await validate(fixture);

    expect(errors).toHaveLength(1);
  });
});
