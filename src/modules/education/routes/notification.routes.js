import { Router } from 'express';
import { ah } from '../utils/asyncHandler.js';
import * as notifications from '../services/notification.service.js';

const r = Router();

r.get('/', ah(async (req, res) => res.json(await notifications.listNotifications(req.user.id))));
r.post('/read', ah(async (req, res) => res.json(await notifications.markRead(req.user.id, req.body?.ids))));
r.post('/read-all', ah(async (req, res) => res.json(await notifications.markAllRead(req.user.id))));
r.post('/delete', ah(async (req, res) => res.json(await notifications.deleteNotifications(req.user.id, req.body?.ids))));
r.post('/delete-all', ah(async (req, res) => res.json(await notifications.deleteAll(req.user.id))));

export default r;
