/**
 * Project environment loader.
 *
 * The repository's .env is the source of truth. A stale machine-level variable
 * (for example an expired OPENAI_API_KEY set in Windows) must not silently
 * shadow the key the project was configured with, otherwise the AI router
 * fails with an authentication error even though .env is correct.
 *
 * Imported first by server.js and by lib/model-router.js so every consumer sees
 * the same values.
 */
import dotenv from 'dotenv';

dotenv.config({ override: true });
