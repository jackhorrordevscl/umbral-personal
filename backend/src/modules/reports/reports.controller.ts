import {
  Controller,
  Get,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { AuditRead } from '../../common/decorators/audit-read.decorator';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';

// Issue #504: solo 'reports-export' (buildReportsThrottlerOptions) limita acá.
// ThrottlerModule es @Global(), así que se saltean los throttlers de los demás
// módulos; reports.controller.spec.ts recorre los registrados para que uno
// nuevo sin saltar rompa el test.
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@SkipThrottle({
  login: true,
  'mfa-verify': true,
  signup: true,
  'mfa-setup': true,
  'verify-email': true,
  'mfa-recover': true,
  'password-change': true,
  'resend-verification': true,
  'password-reset': true,
  'public-availability': true,
  'public-booking': true,
  'payment-confirm': true,
  'payment-return': true,
  'profile-update': true,
  'email-change-confirm': true,
})
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  // failClosed: la ficha completa no sale sin su fila EXPORT_PDF. Por eso se
  // devuelve un StreamableFile (Nest envía la respuesta después de los
  // interceptores) en vez de cerrar la respuesta con @Res().
  @AuditRead({ action: 'EXPORT_PDF', failClosed: true })
  @Get('patient/:patientId')
  async generateReport(
    @Param('patientId') patientId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<StreamableFile> {
    const buffer = await this.reportsService.generatePatientReport(
      patientId,
      user.id,
    );

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="ficha-${patientId}.pdf"`,
      length: buffer.length,
    });
  }
}
