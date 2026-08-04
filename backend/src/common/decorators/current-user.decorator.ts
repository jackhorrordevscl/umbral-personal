import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

// Forma real de lo que JwtStrategy.validate() devuelve y Passport adjunta a
// request.user (ver jwt.strategy.ts) -- sin esto, getRequest() es `any` y
// cada @CurrentUser() consumido en un controller también queda `any`.
export interface RequestUser {
  id: string;
  email: string;
  role: string;
  name: string;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: RequestUser }>();
    return request.user;
  },
);
