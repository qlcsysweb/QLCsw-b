import { prisma } from '../config/prisma.js';
import { HttpError, badRequest, notFound } from '../utils/httpError.js';
import { actorOf, recordEvent } from './adminEvent.service.js';
import { sendClientEmail } from './email.service.js';
import { prepareFiles, streamStoredFile, uploadFiles } from './appointmentChat.service.js';

export const SESSION_MINUTES = 20;
export const CREDIT_KINDS = ['CONSULTA', 'ORIENTACION'];

const usable = (userId, kind, now = new Date()) => ({ userId, kind, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

export async function creditBalance(userId, db = prisma) {
  const rows = await db.serviceCredit.groupBy({ by: ['kind'], where: { userId, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, _count: { _all: true } });
  const count = (k) => rows.find((r) => r.kind === k)?._count._all || 0;
  return { CONSULTA: count('CONSULTA'), ORIENTACION: count('ORIENTACION'), sessionMinutes: SESSION_MINUTES };
}

export async function grantCredits(db, { userId, kind, quantity = 1, source, paymentAttemptId = null, grantId = null, expiresAt = null }) {
  if (!quantity) return;
  await db.serviceCredit.createMany({ data: Array.from({ length: quantity }, () => ({ userId, kind, source, paymentAttemptId, grantId, expiresAt })) });
}

export async function consumeCredits(db, userId, kind, quantity, usedRef) {
  const credits = await db.serviceCredit.findMany({ where: usable(userId, kind), orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], take: quantity });
  if (credits.length < quantity) {
    const label = kind === 'CONSULTA' ? 'consultas' : 'sesiones de orientación';
    throw new HttpError(402, `No tienes ${label} disponibles. Adquiere ${quantity > 1 ? `${quantity} ${label}` : kind === 'CONSULTA' ? 'una consulta' : 'una sesión'} para continuar.`);
  }
  const now = new Date();
  for (const c of credits) {
    const claimed = await db.serviceCredit.updateMany({ where: { id: c.id, usedAt: null }, data: { usedAt: now, usedRef } });
    if (!claimed.count) throw new HttpError(409, 'El crédito ya fue utilizado, intenta de nuevo');
  }
  return credits.map((c) => c.id);
}

export async function releaseCredits(db, usedRef) {
  await db.serviceCredit.updateMany({ where: { usedRef }, data: { usedAt: null, usedRef: null } });
}

const questionView = (q) => ({
  id: q.id,
  moduleNumber: q.moduleNumber,
  question: q.question,
  answer: q.answer,
  answeredAt: q.answeredAt,
  createdAt: q.createdAt,
  files: (q.files || []).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, by: f.uploadedByRole })),
  user: q.user ? { id: q.user.id, name: q.user.name, email: q.user.email } : undefined,
});

const QUESTION_SECTION = 'Consultas';
const FILES = { files: { orderBy: { createdAt: 'asc' } } };

async function attachFiles(question, owner, role, prepared) {
  const uploaded = await uploadFiles(owner, QUESTION_SECTION, `Consulta_M${question.moduleNumber}`, prepared);
  if (uploaded.length) await prisma.moduleQuestionFile.createMany({ data: uploaded.map((u) => ({ ...u, questionId: question.id, uploadedByRole: role })) });
}

export async function streamQuestionFile(user, fileId, range, res) {
  const file = await prisma.moduleQuestionFile.findUnique({ where: { id: fileId }, include: { question: { select: { userId: true } } } });
  if (!file || (user.role !== 'ADMIN' && file.question.userId !== user.id)) throw notFound('Archivo no encontrado');
  await streamStoredFile(file.driveFileId, file.name, range, res);
}

export async function listQuestions(userId, moduleNumber) {
  const rows = await prisma.moduleQuestion.findMany({ where: { userId, moduleNumber }, include: FILES, orderBy: { createdAt: 'desc' } });
  return { items: rows.map(questionView), credits: await creditBalance(userId) };
}

export async function askQuestion(req, moduleNumber, text, files = []) {
  const question = String(text || '').trim();
  if (question.length < 5) throw badRequest('Escribe tu consulta');
  if (question.length > 3000) throw badRequest('La consulta es demasiado larga');
  const prepared = prepareFiles(files);
  const userId = req.subjectId;
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.moduleQuestion.create({ data: { userId, moduleNumber, question } });
    if (!req.asAdmin) {
      const [creditId] = await consumeCredits(tx, userId, 'CONSULTA', 1, row.id);
      return tx.moduleQuestion.update({ where: { id: row.id }, data: { creditId } });
    }
    return row;
  });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  await attachFiles(created, user, req.asAdmin ? 'ADMIN' : 'CLIENT', prepared);
  recordEvent({ category: 'PLATAFORMA', type: 'NUEVA_CONSULTA', actor: actorOf(user), user, status: `Módulo ${moduleNumber}`, result: `${question.slice(0, 300)}${prepared.length ? ` · ${prepared.length} archivo(s)` : ''}` }).catch(() => null);
  return questionView(await prisma.moduleQuestion.findUnique({ where: { id: created.id }, include: FILES }));
}

export async function adminQuestions({ status } = {}) {
  const rows = await prisma.moduleQuestion.findMany({
    where: status === 'PENDING' ? { answeredAt: null } : status === 'ANSWERED' ? { answeredAt: { not: null } } : {},
    include: { user: true, ...FILES },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const pending = await prisma.moduleQuestion.count({ where: { answeredAt: null } });
  return { items: rows.map(questionView), pending };
}

export async function answerQuestion(admin, id, text, files = []) {
  const answer = String(text || '').trim();
  if (!answer) throw badRequest('Escribe la respuesta');
  const prepared = prepareFiles(files);
  const row = await prisma.moduleQuestion.findUnique({ where: { id }, include: { user: true } });
  if (!row) throw notFound('Consulta no encontrada');
  await attachFiles(row, row.user, 'ADMIN', prepared);
  const updated = await prisma.moduleQuestion.update({ where: { id }, data: { answer, answeredAt: new Date(), answeredById: admin.id }, include: { user: true, ...FILES } });
  sendClientEmail('CONSULTA_RESPONDIDA', 'questionAnswered', updated.user.email, { name: updated.user.name, moduleNumber: updated.moduleNumber }).catch(() => null);
  return questionView(updated);
}
