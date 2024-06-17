import type { RequireDrizzleKit } from '@payloadcms/drizzle/types'

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
export const requireDrizzleKit: RequireDrizzleKit = () => {
  const { pushSQLiteSchema: pushSchema } = require('drizzle-kit/payload')
  return { pushSchema }
}