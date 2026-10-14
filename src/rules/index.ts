import type { Check } from '../core/types.js';
import { c2Checks } from './c2.js';
import { cpp20Checks } from './cpp20.js';
import { cChecks } from './c.js';
import { esChecks } from './es.js';
import { es2Checks } from './es2.js';
import { es3Checks } from './es3.js';
import { fChecks } from './f.js';
import { f2Checks } from './f2.js';
import { m1Checks } from './m1.js';
import { m2Checks } from './m2.js';
import { m3Checks } from './m3.js';
import { nlLayoutChecks } from './nl.js';
import { nlNamingChecks } from './nl2.js';
import { rChecks } from './r.js';

export const allChecks: Check[] = [
  ...esChecks,
  ...es2Checks,
  ...es3Checks,
  ...rChecks,
  ...fChecks,
  ...f2Checks,
  ...cChecks,
  ...c2Checks,
  ...m1Checks,
  ...m2Checks,
  ...m3Checks,
  ...nlLayoutChecks,
  ...nlNamingChecks,
  ...cpp20Checks,
];
