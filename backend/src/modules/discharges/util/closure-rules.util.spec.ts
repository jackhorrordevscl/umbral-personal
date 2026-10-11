import { BadRequestException } from '@nestjs/common';
import { assertClosureRules } from './closure-rules.util';

const ok = (over: Record<string, unknown> = {}) => ({
  closureReason: 'DISCHARGED' as const,
  dropoutReason: null,
  dropoutNote: null,
  referralDestination: null,
  ...over,
});

describe('assertClosureRules', () => {
  it('acepta un alta sin campos de deserción ni derivación', () => {
    expect(() => assertClosureRules(ok())).not.toThrow();
  });

  it('rechaza ACTIVE como motivo de cierre', () => {
    expect(() =>
      assertClosureRules(ok({ closureReason: 'ACTIVE' as never })),
    ).toThrow(BadRequestException);
  });

  it('exige dropoutReason cuando es DROPPED_OUT', () => {
    expect(() =>
      assertClosureRules(ok({ closureReason: 'DROPPED_OUT' as never })),
    ).toThrow(/motivo de la deserción/i);
    expect(() =>
      assertClosureRules(
        ok({ closureReason: 'DROPPED_OUT' as never, dropoutReason: 'COST' }),
      ),
    ).not.toThrow();
  });

  it.each(['DISCHARGED', 'REFERRED'])(
    'prohíbe dropoutReason cuando el cierre es %s',
    (closureReason) => {
      expect(() =>
        assertClosureRules(
          ok({ closureReason: closureReason as never, dropoutReason: 'COST' }),
        ),
      ).toThrow(BadRequestException);
    },
  );

  it('permite dropoutNote solo con dropoutReason OTHER', () => {
    const dropped = { closureReason: 'DROPPED_OUT' as never };
    expect(() =>
      assertClosureRules(
        ok({ ...dropped, dropoutReason: 'OTHER', dropoutNote: 'Viaje' }),
      ),
    ).not.toThrow();
    expect(() =>
      assertClosureRules(
        ok({ ...dropped, dropoutReason: 'COST', dropoutNote: 'Viaje' }),
      ),
    ).toThrow(BadRequestException);
  });

  it('permite referralDestination solo con REFERRED', () => {
    expect(() =>
      assertClosureRules(
        ok({ closureReason: 'REFERRED', referralDestination: 'CESFAM' }),
      ),
    ).not.toThrow();
    expect(() =>
      assertClosureRules(ok({ referralDestination: 'CESFAM' })),
    ).toThrow(BadRequestException);
  });
});
