# incident-database Specification

## Purpose

Connects incident API routes to the application database using a host-provided connection string, without a database host or password committed in the repository.

## Requirements

### Requirement: Incident routes use DATABASE_URL from the environment
Incident API routes SHALL open Postgres with the `DATABASE_URL` environment variable. The repository MUST NOT commit a `.env` file or a database host. When `DATABASE_URL` is unset or blank, the connection helper SHALL throw and MUST NOT fall back to a host embedded in source.

#### Scenario: Connection string provided
- **WHEN** `DATABASE_URL` is a non-blank connection string
- **THEN** the pool uses that string

#### Scenario: Connection string missing
- **WHEN** `DATABASE_URL` is unset or blank
- **THEN** the helper throws an error that tells the operator to set `DATABASE_URL` in the Vercel project environment
- **THEN** no embedded cluster host is contacted
