import { getT } from './index.js'
import locales from './locales.json'

// Only the bundled preview messages are translated; real messages remain user content.
export const t = getT(locales)
