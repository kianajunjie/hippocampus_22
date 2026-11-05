/**
 * dsh-hippocampus — entry point.
 *
 * Two faces, one package:
 *   · library users  → `import { createHippocampus } from 'dsh-hippocampus'`
 *   · DSH host       → loads `name` / `inject` / `apply` from this same file
 *
 * The memory core lives in src/ and never imports anything from DSH, so the
 * library keeps working outside the harness.
 */
export {
  createHippocampus,
  resolveConfig,
  candidates,
  formatRecall,
  daysBetween,
} from './src/index.mjs'

export { name, inject, apply } from './src/adapters/dsh.mjs'
export { createMemoryServer } from './src/adapters/http.mjs'
