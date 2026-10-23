import { handleSession } from '../../server/ai-session.js';
export function onRequest(context) { return handleSession(context.request,context.env); }
