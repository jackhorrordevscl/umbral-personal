import { ConfigService } from '@nestjs/config';
import { ClinicalTextCryptoService } from './clinical-text-crypto.service';
import { buildKeyring, encryptTextWithKeyring } from './keyring';

// Helper de pruebas: servicio de cifrado de textos clínicos con una clave fija
// de ejemplo, ya inicializado (equivale a lo que hace Nest en onModuleInit).
const TEST_KEY = Buffer.alloc(32, 21).toString('base64');

// Un texto como los que ya existían en la base antes de enc:v4 (issue #486):
// enc:v3, con la misma clave de prueba y sin ligar a ningún registro.
export function buildTestLegacyV3Text(plain: string): string {
  const keyring = buildKeyring(
    TEST_KEY,
    undefined,
    undefined,
    'CLINICAL_TEXT_ENCRYPTION_KEY',
  );
  return encryptTextWithKeyring(Buffer.from(plain, 'utf8'), keyring);
}

export function buildTestClinicalCrypto(): ClinicalTextCryptoService {
  const values: Record<string, string> = {
    CLINICAL_TEXT_ENCRYPTION_KEY: TEST_KEY,
  };
  const config = {
    get: (name: string) => values[name],
  } as unknown as ConfigService;
  const service = new ClinicalTextCryptoService(config);
  service.onModuleInit();
  return service;
}
