import { Router } from 'express';
import { auth } from '../middleware/auth';
import { queryLeads } from '../controllers/queryLeads';

const router = Router();

router.post('/query', auth, (req, res, next) => {
  queryLeads(req, res).catch(next);
});

export default router;
