// ===========================================================================
// 5 BOROUGHS ON THE TAKE — persistence.js
// Save and load game state to/from a JSON file.
// ===========================================================================
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const DEFAULT_SAVE_PATH = 'savegame.json';

/**
 * Save the full game state to a JSON file.
 * Returns { ok, description }.
 */
export function saveGame(state, path = DEFAULT_SAVE_PATH) {
  try {
    const data = JSON.stringify(state, null, 2);
    writeFileSync(path, data, 'utf-8');
    return { ok: true, description: `Game saved to ${path} (${data.length} bytes).` };
  } catch (e) {
    return { ok: false, description: `Save failed: ${e.message}` };
  }
}

/**
 * Load game state from a JSON file.
 * Returns { ok, state, description }.
 */
export function loadGame(path = DEFAULT_SAVE_PATH) {
  try {
    if (!existsSync(path)) {
      return { ok: false, state: null, description: `No save file found at ${path}.` };
    }
    const data = readFileSync(path, 'utf-8');
    const state = JSON.parse(data);
    return { ok: true, state, description: `Game loaded from ${path}.` };
  } catch (e) {
    return { ok: false, state: null, description: `Load failed: ${e.message}` };
  }
}

/**
 * Check if a save file exists.
 */
export function hasSaveFile(path = DEFAULT_SAVE_PATH) {
  return existsSync(path);
}
