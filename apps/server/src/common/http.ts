import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';

/**
 * Every error response has the same shape: `{ error: { code, message } }`. `code` is a stable
 * English identifier for clients; `message` is Chinese text that can be shown to the user.
 */
export class ApiError extends HttpException {
  constructor(status: number, readonly code: string, message: string) {
    super({ error: { code, message } }, status);
  }
}

export const badRequest = (message: string, code = 'bad_request') => new ApiError(400, code, message);
export const unauthorized = (message = '请先登录', code = 'unauthorized') => new ApiError(401, code, message);
export const notFound = (message = '找不到', code = 'not_found') => new ApiError(404, code, message);
export const conflict = (message: string, code = 'conflict') => new ApiError(409, code, message);
export const tooMany = (message = '操作太频繁，请稍后再试') => new ApiError(429, 'too_many_requests', message);

/** Validates a request body / query with zod; the first problem becomes a 400 with a readable message. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue.path.length ? `${issue.path.join('.')}：` : '';
  throw badRequest(`${where}${issue.message}`, 'invalid_input');
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof ApiError) {
      res.status(err.getStatus()).json(err.getResponse());
      return;
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const message =
        status === HttpStatus.NOT_FOUND ? '接口不存在' : status === HttpStatus.PAYLOAD_TOO_LARGE ? '内容太大' : err.message;
      res.status(status).json({ error: { code: `http_${status}`, message } });
      return;
    }
    this.log.error(err instanceof Error ? err.stack ?? err.message : String(err));
    res.status(500).json({ error: { code: 'internal', message: '服务器出错了，请稍后再试' } });
  }
}
