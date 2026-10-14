import type { Check } from '../core/types.js';
import { esChecks } from './es.js';

export const allChecks: Check[] = [...esChecks];
