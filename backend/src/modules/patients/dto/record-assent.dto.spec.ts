import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RecordAssentDto } from './record-assent.dto';

describe('RecordAssentDto', () => {
  const valid = { action: 'GRANTED' };

  it('acepta solo la acción', async () => {
    expect(
      await validate(plainToInstance(RecordAssentDto, valid)),
    ).toHaveLength(0);
  });

  it('acepta nota y documento', async () => {
    const dto = plainToInstance(RecordAssentDto, {
      ...valid,
      note: 'Conversado con el paciente',
      documentId: '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b',
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['GRANTED', 'REFUSED', 'WITHDRAWN', 'INFORMED_AND_HEARD'])(
    'acepta la acción %s',
    async (action) => {
      expect(
        await validate(plainToInstance(RecordAssentDto, { action })),
      ).toHaveLength(0);
    },
  );

  it('rechaza una acción inválida', async () => {
    const errors = await validate(
      plainToInstance(RecordAssentDto, { action: 'MAYBE' }),
    );

    expect(errors.map((e) => e.property)).toContain('action');
  });

  it('rechaza una nota de 501 caracteres y acepta una de 500', async () => {
    const tooLong = await validate(
      plainToInstance(RecordAssentDto, { ...valid, note: 'x'.repeat(501) }),
    );
    const ok = await validate(
      plainToInstance(RecordAssentDto, { ...valid, note: 'x'.repeat(500) }),
    );

    expect(tooLong.map((e) => e.property)).toContain('note');
    expect(ok).toHaveLength(0);
  });

  it('rechaza un documentId que no es UUID', async () => {
    const errors = await validate(
      plainToInstance(RecordAssentDto, { ...valid, documentId: 'abc' }),
    );

    expect(errors.map((e) => e.property)).toContain('documentId');
  });
});
