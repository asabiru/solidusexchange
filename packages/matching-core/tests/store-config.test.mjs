import assert from "node:assert/strict";
import test from "node:test";

import { resolveJournalStoreEnv, StoreConfigError } from "../src/journal-store.mjs";

test("the journal store backend defaults to memory with no DSN", () => {
  for (const env of [{}, { MATCHING_CORE_STORE: "memory" }]) {
    const plan = resolveJournalStoreEnv(env);
    assert.equal(plan.mode, "memory");
    assert.equal(plan.dsn, null);
  }
});

test("postgres mode requires a valid PostgreSQL DSN", () => {
  for (const env of [
    { MATCHING_CORE_STORE: "postgres" },
    { MATCHING_CORE_STORE: "postgres", MATCHING_CORE_STORE_DSN: "" },
    { MATCHING_CORE_STORE: "postgres", MATCHING_CORE_STORE_DSN: "not a url" },
    { MATCHING_CORE_STORE: "postgres", MATCHING_CORE_STORE_DSN: "mysql://127.0.0.1/db" },
    { MATCHING_CORE_STORE: "postgres", MATCHING_CORE_STORE_DSN: "http://127.0.0.1/db" },
  ]) {
    assert.throws(
      () => resolveJournalStoreEnv(env),
      (error) => error instanceof StoreConfigError && /MATCHING_CORE_STORE_DSN/u.test(error.message),
      JSON.stringify(env),
    );
  }
});

test("postgres mode accepts postgres and postgresql URLs", () => {
  for (const dsn of ["postgres://u:p@127.0.0.1:5432/db", "postgresql://u:p@127.0.0.1:5432/db"]) {
    const plan = resolveJournalStoreEnv({
      MATCHING_CORE_STORE: "postgres",
      MATCHING_CORE_STORE_DSN: dsn,
    });
    assert.equal(plan.mode, "postgres");
    assert.equal(plan.dsn, dsn);
  }
});

test("a DSN without postgres mode is a configuration error", () => {
  for (const env of [
    { MATCHING_CORE_STORE_DSN: "postgres://u:p@127.0.0.1:5432/db" },
    { MATCHING_CORE_STORE: "memory", MATCHING_CORE_STORE_DSN: "postgres://u:p@127.0.0.1:5432/db" },
  ]) {
    assert.throws(
      () => resolveJournalStoreEnv(env),
      (error) =>
        error instanceof StoreConfigError && /requires MATCHING_CORE_STORE=postgres/u.test(error.message),
      JSON.stringify(env),
    );
  }
});

test("unknown store modes fail closed", () => {
  for (const mode of ["file", "redis", "production", "POSTGRES"]) {
    assert.throws(
      () => resolveJournalStoreEnv({ MATCHING_CORE_STORE: mode }),
      (error) =>
        error instanceof StoreConfigError && /MATCHING_CORE_STORE must be/u.test(error.message),
      mode,
    );
  }
});

test("the resolved plan is frozen", () => {
  const plan = resolveJournalStoreEnv({});
  assert.equal(Object.isFrozen(plan), true);
});

test("non-string environment values are rejected", () => {
  for (const env of [
    { MATCHING_CORE_STORE: 1 },
    { MATCHING_CORE_STORE: null },
    { MATCHING_CORE_STORE: [] },
    { MATCHING_CORE_STORE: "postgres", MATCHING_CORE_STORE_DSN: 1 },
  ]) {
    assert.throws(() => resolveJournalStoreEnv(env), StoreConfigError, JSON.stringify(env));
  }
});
