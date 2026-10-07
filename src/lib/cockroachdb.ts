import pg from 'pg';
import type { Incident, AgentAction, Runbook } from './types';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export const DATABASE_URL_MISSING =
  'DATABASE_URL is not set. Set it in the Vercel project environment. Do not commit a .env file.';

/** Connection string for the incident store. Blank values count as unset. */
export function requireDatabaseUrl(raw: string | undefined = process.env.DATABASE_URL): string {
  const url = raw?.trim();
  if (!url) throw new Error(DATABASE_URL_MISSING);
  return url;
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireDatabaseUrl(),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
  }
  return pool;
}

export async function query(text: string, params?: unknown[]) {
  const p = getPool();
  const result = await p.query(text, params);
  return result;
}

export function rowToIncident(row: Record<string, unknown>): Incident {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    severity: row.severity as Incident['severity'],
    status: row.status as Incident['status'],
    source: row.source as string,
    agent_notes: (row.agent_notes as string) || null,
    resolution_summary: (row.resolution_summary as string) || null,
    created_at: new Date(row.created_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
    resolved_at: row.resolved_at ? new Date(row.resolved_at as string).toISOString() : null,
  };
}

export function rowToAction(row: Record<string, unknown>): AgentAction {
  return {
    id: row.id as string,
    incident_id: row.incident_id as string,
    agent_type: row.agent_type as AgentAction['agent_type'],
    action: row.action as string,
    input_data: (row.input_data as string) || null,
    output_data: (row.output_data as string) || null,
    status: row.status as AgentAction['status'],
    duration_ms: (row.duration_ms as number) || null,
    created_at: new Date(row.created_at as string).toISOString(),
  };
}

export function rowToRunbook(row: Record<string, unknown>): Runbook {
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    category: row.category as string,
    created_at: new Date(row.created_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
  };
}