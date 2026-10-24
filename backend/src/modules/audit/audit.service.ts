import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface CreateAuditLogDto {
  userId?: string;
  action: AuditAction;
  resource: string;
  resourceId: string;
  detail?: string;
  ipAddress?: string;
  userAgent?: string;
}

// El User-Agent lo manda el cliente y `detail` incluye la URL de la petición:
// ambos se recortan para que una fila de auditoría no crezca sin límite.
export const AUDIT_USER_AGENT_MAX_LENGTH = 512;
export const AUDIT_DETAIL_MAX_LENGTH = 1024;

function clamp(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value.length <= max) return value;
  const cut = value.slice(0, max);
  // No dejar a la mitad un par sustituto (emoji): no se puede codificar en UTF-8.
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  // Único método permitido — solo escritura, nunca update ni delete
  async log(data: CreateAuditLogDto) {
    return this.prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        detail: clamp(data.detail, AUDIT_DETAIL_MAX_LENGTH),
        ipAddress: data.ipAddress,
        userAgent: clamp(data.userAgent, AUDIT_USER_AGENT_MAX_LENGTH),
      },
    });
  }
}
