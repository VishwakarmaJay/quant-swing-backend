import { Router } from 'express';

const router = Router();

router.get('/me', (req, res) => res.json({ user: req.user }));

export default router;
