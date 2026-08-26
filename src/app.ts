import express from 'express';
import leadsRouter from './routes/leads';
import { errorHandler } from './middleware/error-handler';

export function createApp() {
  const app = express();

  app.use(express.json());

  // Root route
  app.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      message: 'Lead Query API is running',
    });
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
    });
  });

  // Leads API
  app.use('/api/v1/leads', leadsRouter);

  // Error handler
  app.use(errorHandler);

  return app;
}

const app = createApp();

export default app;