import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UploadDischargeDto } from './upload-discharge.dto';

async function errorsOf(plain: Record<string, unknown>) {
  const errors = await validate(plainToInstance(UploadDischargeDto, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('UploadDischargeDto', () => {
  it('acepta solo el motivo de cierre', async () => {
    expect(await errorsOf({ closureReason: 'DISCHARGED' })).toEqual([]);
  });

  it('trata los campos opcionales vacíos de multipart como ausentes', async () => {
    expect(
      await errorsOf({
        closureReason: 'DISCHARGED',
        dischargeDate: '',
        dropoutReason: '',
        dropoutNote: '',
        referralDestination: '',
      }),
    ).toEqual([]);
  });

  it('rechaza ACTIVE, ausencia de motivo y fechas inválidas', async () => {
    expect(await errorsOf({ closureReason: 'ACTIVE' })).toEqual([
      'closureReason',
    ]);
    expect(await errorsOf({})).toEqual(['closureReason']);
    expect(
      await errorsOf({
        closureReason: 'DISCHARGED',
        dischargeDate: '2026-02-30',
      }),
    ).toEqual(['dischargeDate']);
  });

  it('rechaza un dropoutReason fuera de la lista cerrada y textos con caracteres de control', async () => {
    expect(
      await errorsOf({
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'INVENTED',
      }),
    ).toEqual(['dropoutReason']);
    expect(
      await errorsOf({
        closureReason: 'REFERRED',
        referralDestination: 'a\u0000b',
      }),
    ).toEqual(['referralDestination']);
  });

  it('rechaza campos que el cliente no puede fijar (mass assignment)', async () => {
    for (const field of [
      'source',
      'status',
      'contentHash',
      'pdfSha256',
      'version',
      'groupId',
      'correctsId',
      'signerName',
      'signerRut',
      'documentId',
      'therapistId',
      'patientId',
      'consultReason',
    ]) {
      expect(
        await errorsOf({ closureReason: 'DISCHARGED', [field]: 'x' }),
      ).toEqual([field]);
    }
  });
});
