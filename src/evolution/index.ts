/**
 * Evolution module — Genesis template evolution tracking.
 *
 * Exports schema types, SQLite store functions, and the Fastify API plugin
 * for recording and querying template evolution records.
 */
export { TemplateEvolutionSchema, CoreMemoryEntrySchema } from './schema.js';
export type { TemplateEvolution, CoreMemoryEntry } from './schema.js';
export { initEvolutionTable, insertEvolution, getLatestEvolution, getEvolutionHistory } from './store.js';
export { default as evolutionPlugin } from './api.js';
export type { EvolutionPluginOptions } from './api.js';
