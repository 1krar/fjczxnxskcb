import { handleAI } from '../../server/ai-service.js';
export function onRequest({request,env}) { return handleAI(request,env); }
