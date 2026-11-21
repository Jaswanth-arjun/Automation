/**
 * REAL sprite manifest. Drop your PNG/WebP sheets in /public/hamster/sheets/ using
 * the names below (<animationId>.png). Missing files are skipped automatically:
 * behaviors that need them are disabled, everything else keeps working, so you
 * can add sheets one at a time.
 *
 * cell    : size of ONE frame in the sheet (same for every sheet => same scale)
 * groundY : y (in px, inside the cell) where the hamster's feet touch the ground
 */
import { ANIMATIONS } from './animations.config.js';

/** Sheets that really exist. Add an id here when you drop its PNG into /public/hamster/sheets/. */
export const ENABLED = ['walking'];

export function createManifest(baseUrl = '/hamster/', ext = 'png', enabled = ENABLED) {
  const sheets = {};
  for (const id of enabled) sheets[id] = { url: `${baseUrl}sheets/${id}.${ext}`, columns: 4 };
  if (sheets.walking) sheets.walkPause = { sameAs: 'walking', frameMap: [0] };   // standing still = walking frame 1
  return {
    cell: { w: 512, h: 512 },
    groundY: 488,
    sheets,
    props: {},
  };
}
export default createManifest();
