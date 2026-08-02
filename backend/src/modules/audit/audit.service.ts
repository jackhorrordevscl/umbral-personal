import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface CreateAuditLogDto {
  userId?: string;
  action: string;
  resource: string;
  resourceId: string;
  detail?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  // Único método permitido — solo escritura, nunca update ni delete
  async log(data: CreateAuditLogDto) {
    return this.prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action as any,
        resource: data.resource,
        resourceId: data.resourceId,
        detail: data.detail,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  }
}