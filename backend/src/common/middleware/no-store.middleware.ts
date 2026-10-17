import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// Hallazgo del judgment-day transversal (#502): toda la API sirve datos
// autenticados o clínicos (JSON, PDFs, descargas de documentos) y helmet() no
// fija Cache-Control, así que el navegador podía guardarlos en su caché. Se
// marca cada respuesta como no almacenable antes de que llegue a los guards,
// para que también las respuestas de error la lleven.
@Injectable()
export class NoStoreMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }
}
