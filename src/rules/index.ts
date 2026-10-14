import type { Check } from '../core/types.js';
import { esChecks } from './es.js';
import { es2Checks } from './es2.js';
import { es3Checks } from './es3.js';
import { fChecks } from './f.js';
import { f2Checks } from './f2.js';
import { rChecks } from './r.js';

export const allChecks: Check[] = [...esChecks, ...es2Checks, ...es3Checks, ...rChecks, ...fChecks, ...f2Checks];
