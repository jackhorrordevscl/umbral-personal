import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyMfaDto } from './verify-mfa.dto';
import { UploadDocumentDto } from '../../documents/dto/upload-document.dto';

// Issue #212: los ids llegaban como @IsString() sin forma ni cota.
const UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('DTOs con ids y tokens acotados (#212, #302)', () => {
  it('VerifyMfaDto acepta un mfaToken acotado y rechaza vacío o desmedido', async () => {
    const ok = plainToInstance(VerifyMfaDto, {
      mfaToken: 'a.b.c',
      token: '123456',
    });
    const empty = plainToInstance(VerifyMfaDto, {
      mfaToken: '',
      token: '123456',
    });
    const huge = plainToInstance(VerifyMfaDto, {
      mfaToken: 'x'.repeat(5000),
      token: '123456',
    });
    const legacy = plainToInstance(VerifyMfaDto, {
      userId: UUID,
      token: '123456',
    });

    expect(await validate(ok)).toHaveLength(0);
    expect((await validate(empty)).map((e) => e.property)).toContain(
      'mfaToken',
    );
    expect((await validate(huge)).map((e) => e.property)).toContain('mfaToken');
    // A bare userId is no longer accepted: mfaToken is required.
    expect((await validate(legacy)).map((e) => e.property)).toContain(
      'mfaToken',
    );
  });

  it('UploadDocumentDto acepta UUIDs y rechaza ids con otra forma', async () => {
    const ok = plainToInstance(UploadDocumentDto, {
      patientId: UUID,
      type: 'OTHER',
      consultationGroupId: UUID,
    });
    const bad = plainToInstance(UploadDocumentDto, {
      patientId: 'no-es-uuid',
      type: 'OTHER',
      consultationGroupId: 'tampoco',
    });

    expect(await validate(ok)).toHaveLength(0);
    expect((await validate(bad)).map((e) => e.property).sort()).toEqual([
      'consultationGroupId',
      'patientId',
    ]);
  });
});
