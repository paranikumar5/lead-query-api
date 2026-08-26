import express from 'express';
import leadsRouter from './routes/leads';
import { errorHandler } from './middleware/error-handler';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/v1/leads', leadsRouter);

  app.use(errorHandler);

  return app;
}
