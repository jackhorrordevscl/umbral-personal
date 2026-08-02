import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import PDFDocument = require('pdfkit');

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private patientsService: PatientsService,
  ) {}

  async generatePatientReport(
    patientId: string,
    userId: string,
    userRole: string,
  ): Promise<Buffer> {
    // Lanza NotFoundException/ForbiddenException si el usuario no tiene acceso a este paciente
    await this.patientsService.findOne(patientId, userId, userRole);

    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        // Solo la versión vigente de cada consulta (T2.3: corregir crea una
        // fila nueva, hay que excluir las versiones ya superadas)
        consultations: {
          where: { correctedBy: null, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        therapist: {
          select: { name: true, email: true },
        },
      },
    });

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    // T6.1 (issue #27): consentSigned/telemedConsentSigned ya no existen como
    // columnas; el estado vigente por finalidad se deriva del ledger
    // append-only PatientConsent.
    const consentStatus = await this.patientsService.getCurrentConsentStatus(
      patientId,
      userId,
      userRole,
    );

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // ── ENCABEZADO ──────────────────────────────────────
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('UMBRAL SpA', { align: 'center' });

      doc
        .fontSize(12)
        .font('Helvetica')
        .text('Ficha Clínica del Paciente', { align: 'center' });

      doc
        .fontSize(10)
        .text(`Generado el: ${new Date().toLocaleDateString('es-CL')}`, {
          align: 'center',
        });

      doc.moveDown(2);

      // ── DATOS DEL PACIENTE ───────────────────────────────
      doc.fontSize(14).font('Helvetica-Bold').text('1. Identificación del Paciente');
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      doc.fontSize(10).font('Helvetica');
      doc.text(`Nombre completo: ${patient.fullName}`);
      doc.text(`RUT: ${patient.rut}`);
      doc.text(`Fecha de nacimiento: ${new Date(patient.birthDate).toLocaleDateString('es-CL')}`);
      doc.text(`Ocupación: ${patient.occupation ?? 'No registrada'}`);
      doc.text(`Teléfono: ${patient.phone ?? 'No registrado'}`);
      doc.text(`Email: ${patient.email ?? 'No registrado'}`);
      doc.text(`Dirección: ${patient.address ?? 'No registrada'}`);

      doc.moveDown();
      doc.text(`Contacto de emergencia: ${patient.emergencyContactName ?? 'No registrado'}`);
      doc.text(`Teléfono emergencia: ${patient.emergencyContactPhone ?? 'No registrado'}`);

      doc.moveDown();
      doc.text(`Psiquiatra tratante: ${patient.treatingPsychiatrist ?? 'No registrado'}`);
      doc.text(`Médico tratante: ${patient.treatingDoctor ?? 'No registrado'}`);

      // ── PSICÓLOGO TRATANTE ───────────────────────────────
      doc.text(`Psicólogo/a tratante: ${patient.therapist?.name ?? 'No asignado'}`);

      doc.moveDown();
      doc.text(`Consentimiento informado: ${consentStatus.TREATMENT ? 'Firmado' : 'Pendiente'}`);
      doc.text(`Acuerdo telemedicina: ${consentStatus.TELEMEDICINE ? 'Firmado' : 'Pendiente'}`);

      doc.moveDown(2);

      // ── HISTORIAL CLÍNICO ────────────────────────────────
      doc.fontSize(14).font('Helvetica-Bold').text('2. Historial Clínico');
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      if (patient.consultations.length === 0) {
        doc.fontSize(10).font('Helvetica').text('Sin consultas registradas.');
      } else {
        patient.consultations.forEach((c, index) => {
          // Título de sesión con mejor espaciado
          doc.moveDown(0.5);
          doc
            .rect(50, doc.y, 500, 20)
            .fill('#f1f5f9');

          doc
            .fillColor('#1e293b')
            .fontSize(11)
            .font('Helvetica-Bold')
            .text(
              `Sesión ${index + 1}  —  ${new Date(c.sessionDate).toLocaleDateString('es-CL')}`,
            );

          doc.fillColor('#000000');
          doc.moveDown(0.8);

          doc.fontSize(10).font('Helvetica');
          doc.text(`Tipo: ${c.sessionType === 'IN_PERSON' ? 'Presencial' : 'Telemedicina'}`);

          doc.moveDown(0.3);
          doc.font('Helvetica-Bold').text('Motivo de consulta:', { continued: false });
          doc.font('Helvetica').text(c.consultReason, {
            align: 'justify',
            width: 500,
          });

          doc.moveDown(0.3);
          doc.font('Helvetica-Bold').text('Intervención:', { continued: false });
          doc.font('Helvetica').text(c.intervention, {
            align: 'justify',
            width: 500,
          });

          doc.moveDown(0.3);
          doc.font('Helvetica-Bold').text('Acuerdos:', { continued: false });
          doc.font('Helvetica').text(c.agreements ?? 'Ninguno', {
            align: 'justify',
            width: 500,
          });

          doc.moveDown(0.3);
          doc.text(
            `Próxima sesión: ${c.nextSessionDate ? new Date(c.nextSessionDate).toLocaleDateString('es-CL') : 'No agendada'}`
          );

          doc.moveDown(1);
        });
      }

      // ── PIE DE PÁGINA ────────────────────────────────────
      doc.moveDown(2);
      doc.fontSize(9).font('Helvetica')
        .text('Documento generado por Umbral SpA — Confidencial', { align: 'center' });
      doc.text('Ley 20.584 — Custodia obligatoria 15 años', { align: 'center' });

      doc.end();
    });
  }
}