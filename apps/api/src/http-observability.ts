import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('Http');
export function requestLogger(request: Request, response: Response, next: NextFunction) {
  const id = randomUUID();
  response.setHeader('X-Request-Id', id);
  const start = Date.now();
  response.on('finish', () => logger.log(JSON.stringify({ requestId: id, method: request.method, status: response.statusCode, durationMs: Date.now() - start })));
  next();
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) logger.error(exception instanceof Error ? exception.stack : String(exception));
    const detail = exception instanceof HttpException ? exception.getResponse() : null;
    const message = typeof detail === 'string' ? detail : detail && typeof detail === 'object' && 'message' in detail ? detail.message : 'Terjadi kesalahan pada server.';
    response.status(status).json({ error: { statusCode: status, message }, requestId: response.getHeader('X-Request-Id') });
  }
}
