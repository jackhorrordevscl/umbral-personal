import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildKeyring,
  decryptTextWithKeyring,
  encryptTextWithKeyring,
  Keyring,
} from './keyring';

const ENV_VAR_NAME = 'CLINICAL_TEXT_ENCRYPTION_KEY';

// Prefijos versionados del texto almacenado (mismo formato que el resto de los
// datasets de texto, ver keyring.ts). Un valor sin prefijo es texto plano
// heredado y decrypt() lo devuelve tal cual.
const CIPHER_PREFIXES = ['enc:v1:', 'enc:v2:', 'enc:v3:'];

// ADR 0004 (opción B) y ADR 0005: cifra a nivel de aplicación los textos
// clínicos libres (notas de consulta e informe de alta) con una clave AES-256-GCM
// propia, nunca compartida con las demás. Formato enc:v3:<keyId>:<base64(iv|tag|ct)>
// con AAD (prefijo, keyId y dataset "clinical"), por lo que un valor movido a
// otro dataset o con el keyId alterado no se descifra.
//
// Contrato: tras activar el cifrado toda escritura de estas columnas pasa por
// encrypt(); el paso de texto plano en decrypt() existe solo para el legado y
// para que el reencriptado pueda leer valores aún sin cifrar.
@Injectable()
export class ClinicalTextCryptoService implements OnModuleInit {
  private keyring!: Keyring;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.keyring = buildKeyring(
      this.config.get<string>(ENV_VAR_NAME),
      this.config.get<string>(`${ENV_VAR_NAME}_KEYRING`),
      this.config.get<string>(`${ENV_VAR_NAME}_ACTIVE_KEY_ID`),
      ENV_VAR_NAME,
    );
  }

  encrypt(text: string): string {
    return encryptTextWithKeyring(Buffer.from(text, 'utf8'), this.keyring);
  }

  decrypt(stored: string): string {
    if (!this.isEncrypted(stored)) return stored;
    return decryptTextWithKeyring(stored, this.keyring).toString('utf8');
  }

  encryptNullable(text: string | null | undefined): string | null {
    return text === null || text === undefined ? null : this.encrypt(text);
  }

  decryptNullable(stored: string | null | undefined): string | null {
    return stored === null || stored === undefined
      ? null
      : this.decrypt(stored);
  }

  isEncrypted(stored: string): boolean {
    return CIPHER_PREFIXES.some((prefix) => stored.startsWith(prefix));
  }
}
