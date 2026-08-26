import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      message: err.message,
      statusCode: err.statusCode,
    });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({
    message: 'Internal server error',
    statusCode: 500,
  });
}
