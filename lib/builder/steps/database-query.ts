import "server-only";

import pg from "pg";
import { fetchCredentials } from "../credential-fetcher";
import { type StepInput, withStepLogging } from "./step-handler";

export type DatabaseQueryInput = StepInput & {
  integrationId?: string;
  dbQuery?: string;
  query?: string;
};

type DatabaseQueryResult =
  | { success: true; rows: unknown; count: number }
  | { success: false; error: string };

function validateInput(input: DatabaseQueryInput): string | null {
  const queryString = input.dbQuery || input.query;
  if (!queryString || queryString.trim() === "") {
    return "SQL query is required";
  }
  return null;
}

function createDatabaseClient(databaseUrl: string): pg.Client {
  const ssl = databaseUrl.includes("sslmode=disable")
    ? undefined
    : { rejectUnauthorized: false };
  return new pg.Client({
    connectionString: databaseUrl,
    ssl,
    statement_timeout: 15000,
    query_timeout: 15000,
  });
}

function getDatabaseErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown database error";
  }

  const errorMessage = error.message;

  if (errorMessage.includes("ECONNREFUSED")) {
    return "Connection refused. Please check your database URL and ensure the database is running.";
  }
  if (errorMessage.includes("ENOTFOUND")) {
    return "Database host not found. Please check your database URL.";
  }
  if (errorMessage.toLowerCase().includes("authentication failed")) {
    return "Authentication failed. Please check your database credentials.";
  }
  if (errorMessage.includes("does not exist")) {
    return `Database error: ${errorMessage}`;
  }

  return errorMessage;
}

async function databaseQuery(
  input: DatabaseQueryInput
): Promise<DatabaseQueryResult> {
  const validationError = validateInput(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};
  const databaseUrl =
    credentials.DATABASE_URL || process.env.DATABASE_URL || "";

  if (!databaseUrl) {
    return {
      success: false,
      error:
        "DATABASE_URL is not configured. Please add it in Project Integrations.",
    };
  }

  const queryString = (input.dbQuery || input.query) as string;
  let client: pg.Client | null = null;

  try {
    client = createDatabaseClient(databaseUrl);
    await client.connect();
    const result = await client.query(queryString);
    return {
      success: true,
      rows: result.rows,
      count: result.rowCount ?? (Array.isArray(result.rows) ? result.rows.length : 0),
    };
  } catch (error) {
    return {
      success: false,
      error: `Database query failed: ${getDatabaseErrorMessage(error)}`,
    };
  } finally {
    if (client) {
      await client.end().catch(() => {});
    }
  }
}

export async function databaseQueryStep(
  input: DatabaseQueryInput
): Promise<DatabaseQueryResult> {
  "use step";
  return withStepLogging(input, () => databaseQuery(input));
}
databaseQueryStep.maxRetries = 0;
