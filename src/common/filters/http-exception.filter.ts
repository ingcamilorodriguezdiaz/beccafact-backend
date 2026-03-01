import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Captura TODAS las excepciones (no solo HttpException).
 * Esto evita que errores de Prisma, TypeErrors, etc. devuelvan
 * un 500 "Internal server error" sin mensaje útil.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    // Determinar status y mensaje según el tipo de excepción
    let status  = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error: Record<string, any> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      error =
        typeof exceptionResponse === 'string'
          ? { message: exceptionResponse }
          : (exceptionResponse as Record<string, any>);
      message = error['message'] ?? message;
    } else if (exception instanceof Error) {
      message = exception.message;
      error   = { message };

      // Detectar errores conocidos de Prisma para devolver mensajes claros
      const prismaCode = (exception as any)?.code as string | undefined;
      if (prismaCode === 'P2002') {
        status  = HttpStatus.CONFLICT;
        message = 'Ya existe un registro con esos datos únicos';
        error   = { message };
      } else if (prismaCode === 'P2025') {
        status  = HttpStatus.NOT_FOUND;
        message = 'Registro no encontrado';
        error   = { message };
      } else if (prismaCode?.startsWith('P')) {
        // Otro error de Prisma — no exponer detalles internos en producción
        status  = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'Error de base de datos';
        error   = { message };
      }
    }

    this.logger.error(
      `${request.method} ${request.url} - ${status}: ${message}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...error,
    });
  }
}
