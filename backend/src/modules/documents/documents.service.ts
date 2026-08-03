import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { DocumentEncryptionService } from './document-encryption.service';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'documents');

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private patientsService: PatientsService,
    private encryption: DocumentEncryptionService,
  ) {}

  // T8.1 (issue #58): el archivo llega en memoria (memoryStorage en el
  // controller, no diskStorage) para poder cifrarlo con AES-256-GCM antes de
  // que exista cualquier bytes sin cifrar en disco. `storagePath` sigue
  // siendo relativo a `process.cwd()`, igual que antes con diskStorage.
  async uploadDocument(
    patientId: string,
    userId: string,
    file: Express.Multer.File,
    type: string,
  ) {
    // Lanza NotFoundException si el paciente no existe o el usuario no
    // tiene acceso a él -- se valida ANTES de escribir nada a disco, así no
    // queda un archivo huérfano que limpiar.
    await this.patientsService.assertAccess(patientId, userId);

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const storedName = `${uniqueSuffix}${path.extname(file.originalname)}.enc`;
    const storagePath = path.join('uploads', 'documents', storedName);

    const encrypted = this.encryption.encrypt(file.buffer);
    fs.writeFileSync(path.join(process.cwd(), storagePath), encrypted);

    return this.prisma.patientDocument.create({
      data: {
        patientId,
        uploadedBy: userId,
        type: type as any,
        fileName: file.originalname,
        storagePath,
      },
    });
  }

  // Devuelve el contenido ya descifrado, listo para servir. La validación de
  // acceso ya la hace `getDocument` (vía `patientsService.findOne`).
  async getDecryptedFile(id: string, userId: string) {
    const doc = await this.getDocument(id, userId);
    const encrypted = fs.readFileSync(
      path.join(process.cwd(), doc.storagePath),
    );
    return { doc, buffer: this.encryption.decrypt(encrypted) };
  }

  async findByPatient(patientId: string, userId: string) {
    // Lanza NotFoundException si el usuario no tiene acceso a este paciente
    await this.patientsService.assertAccess(patientId, userId);

    return this.prisma.patientDocument.findMany({
      where: { patientId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async getDocument(id: string, userId: string) {
    const doc = await this.prisma.patientDocument.findUnique({
      where: { id },
    });

    if (!doc) throw new NotFoundException('Documento no encontrado');

    // Lanza NotFoundException si el usuario no tiene acceso al paciente dueño del documento
    await this.patientsService.assertAccess(doc.patientId, userId);

    return doc;
  }
}
