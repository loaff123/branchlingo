import {parentPort,workerData} from 'node:worker_threads';
import {execute} from './engine.mjs';
import {failure} from './errors.mjs';
try { parentPort.postMessage(execute(workerData.mode,workerData.snapshot)); }
catch(error){parentPort.postMessage(failure(error));}
