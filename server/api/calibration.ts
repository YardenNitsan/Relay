import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { Store } from '../db/store.js';
import type { Engine } from '../orchestration/engine.js';
import type { Providers } from '../providers/index.js';
import { calibrationHistory,calibrationInput,startCalibration } from '../models/calibration.js';

export function calibrationRoutes(app:FastifyInstance,store:Store,engine:Engine,providers:Providers,owner:(request:FastifyRequest)=>unknown) {
  app.get('/api/models/calibrations',async request=>{owner(request);return calibrationHistory(store);});
  app.post('/api/models/calibrations',async request=>{owner(request);const input=calibrationInput.parse(request.body);return startCalibration(store,engine,providers,input.modelId,input.contextTokens,input.protocol);});
}
