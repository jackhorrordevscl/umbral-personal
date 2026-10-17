import { ConfigService } from '@nestjs/config';
import { ClinicalTextCryptoService } from './clinical-text-crypto.service';

// Helper de pruebas: servicio de cifrado de textos clínicos con una clave fija
// de ejemplo, ya inicializado (equivale a lo que hace Nest en onModuleInit).
const TEST_KEY = Buffer.alloc(32, 21).toString('base64');

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
