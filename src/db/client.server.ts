import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { env } from '#/lib/env.server'
import * as schema from './schema'

const client = postgres(env.DATABASE_URL, { max: 5 })

/** Shared Postgres client for server-only modules. */
export const db = drizzle(client, { schema })
