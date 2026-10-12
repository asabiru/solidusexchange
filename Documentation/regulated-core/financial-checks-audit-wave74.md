# Financial-Core Check Machinery Audit — Wave 74 — Proposed

- Status: Proposed
- Scope: the PostgreSQL CI gates themselves — `packages/financial-core/scripts/check-foundation.mjs`, `verify-postgres-{migration-source-catalog,migration-source-policy,relation-catalog,access-control-catalog,invariant-trigger-catalog,runtime-privilege-catalog}.mjs`, and the `.sh`/`.sql` harnesses they consume. Wave 73 audited the contract guard; this wave asks the same question of the ledger gates: can a catalog drift bypass its own checker? Everything is dev-only and synthetic — no production paths, no live data, no money movement.
- Production effect: none

Method: for each catalog, mutate the database or migration text against a live `postgres:16.10` container seeded by `tests/postgres-smoke.sql`, run the verifier on the mutated catalog, and record whether the gate stayed green. Every confirmed bypass was fixed in the same change; every fix was re-probed to confirm the gate now goes red and the clean baseline still passes. Negative arms for every new class were added to the `.sh` harnesses so each bypass stays pinned.

## Defects found and fixed

1. **Invariant-trigger catalog could not see `WHEN`-clause drift.** `tests/postgres-invariant-trigger-catalog.sql` emitted only trigger metadata (name, enabled, timing, events, function); `verify-postgres-invariant-trigger-catalog.mjs` compared that list, so `DROP TRIGGER … WHEN (FALSE)` re-creations — which keep identical metadata — passed green. Probe: recreating `ledger_entries_validate_amount` with `WHEN (FALSE)` passed. Fixed by adding `definition_sha256` (`sha256(pg_get_triggerdef(oid, FALSE))`) to each catalog row — the same pinning the immutability catalog already uses — and a repinned catalog hash `921cdfb3b9fe1888452bf7f2737f2a0bb9885899d15d4798fd2c7f5562f4c49d`.
2. **Two trigger catalog rows were missing from the filter entirely.** The `posting_rule_registry_validate` trigger and its `validate_posting_rule` function — the gate that enforces the posting-rule registry grammar — were absent from the invariant catalog's `proname`/`tgname` lists, so weakening or dropping them produced no catalog change at all. Fixed: `["posting_rule_registry", "posting_rule_registry_validate", "validate_posting_rule"]` added to `immediateTriggers` in the verifier and `'validate_posting_rule'` added to the producer's function list.
3. **Privilege statements targeting roles other than the runtime role were invisible.** `tests/postgres-runtime-privilege-catalog.sql` labelled every recipient by joining only `{runtime_role, public}`; an INSERT privilege on `ledger_entries` for a third role produced no catalog row and stayed green. Fixed: recipients are now labelled via `pg_get_userbyid` for every recipient OID (public = `0`), and implicit owner self-ACLs are filtered by carrying each object's owner (`datdba`/`nspowner`/`relowner`/`proowner`/`typowner`) and dropping rows whose recipient is the object owner.
4. **Conferring the runtime role outward was invisible.** `runtime_memberships` listed only rows where `member = runtime_role.oid`; giving the runtime role itself to another role changed nothing the catalog saw. Fixed: the membership CTE now matches either `member` or `roleid` equal to the runtime role and reports both names.
5. **`ALTER DEFAULT PRIVILEGES` rows for other roles were invisible.** Same join hole as defect 3 on `pg_default_acl`. Fixed by the same recipient labelling plus a recipient-is-not-the-owner filter, restricted to `financial_core` (and global `defaclnamespace = 0`) defaults.
6. **Relation catalog silently ignored most relkinds.** `relation_rows` and `column_rows` filtered `relkind IN ('r','v')`, so `CREATE SEQUENCE`/`MATERIALIZED VIEW`/partitioned/foreign relations produced no catalog row — the catalog hash stayed green. Fixed: relkind now `IN ('r','p','v','m','S','f')` with labelled kind names; repinned hash `0c82e7e8698add8410d598671af395e3c89a870afc7d10e01a580a8229a47ea1`.
7. **Access-control catalog had the same relkind gap.** Its `relation_rows` also filtered `('r','v')`, and non-owner recipients were bucketed as the literal string `non_owner` — a privilege for a third role was invisible. Fixed: same relkind widening (with `acldefault` mapping sequences to `'s'`), and every `non_owner` CASE now resolves the real `pg_get_userbyid` name.
8. **Policies, publications, extended statistics and event triggers were covered by no catalog.** `CREATE POLICY … USING (TRUE)`, `CREATE PUBLICATION … FOR TABLE`, `CREATE STATISTICS` and `CREATE EVENT TRIGGER` all stayed green against every verifier (an event trigger only brushed the access-control catalog through its function-count side effect). Fixed: the relation catalog now emits `policies`, `publications`, `statistics` and `event_triggers` arrays, each pinned empty by `deepStrictEqual` in the verifier — any such object now fails loud.
9. **Source-policy lexer: `$` inside an identifier opened a fake dollar-quoted body.** A tag-less `$` following an identifier character (e.g. `a$history$`) was treated as a dollar-quote delimiter, masking a following `INSERT INTO history` as literal text. Fixed: the dollar-quote branch now requires the previous character not to be `[a-z0-9_$]`; the quoted `E'…'` prefix has the same boundary guard.
10. **Source-policy lexer: mid-line meta-commands and `COPY … TO PROGRAM` were invisible.** The `\command` scan was line-anchored, so `SELECT 1; \g` slipped past, and `copy ledger_journals_history to program 'x'` produced no flagged token. Fixed: `analyzeSql` now returns `maskedMeta` — code positions outside all string/identifier/comment masks — and the verifier asserts it contains no `\`; `COPY` joined the statement-head grammar.
11. **`TRUNCATE`/`DROP TABLE` multi-object lists were invisible.** The history-write matcher required `\s+history_table` immediately after the keyword, so `TRUNCATE a, ledger_journals_history` and `DROP TABLE a, ledger_journals_history` stayed green. Fixed: history-table detection now scans masked statements for the table name token combined with a statement-head allowlist of write verbs (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`MERGE`/`ALTER`/`DROP`/`CREATE`/`COPY`), applied per procedural body statement as well.

## Verified clean (with negative pins)

- **Constraint catalog**: authoritative `pg_catalog.pg_constraint` enumeration; dropping or redefining any CHECK/FK/UNIQUE breaks the pinned hash — mutation probes confirmed red.
- **Immutability catalog**: already pinned `definition_sha256` per trigger plus a `WHEN (FALSE)` negative arm; re-verified red on fresh probes.
- **Trigger-function catalog** and **migration-source catalog**: full-definition hashes over authoritative enumerations; any function-body or migration-file drift changes the hash.
- **Execution-surface catalog**: catches every trigger the invariant and immutability catalogs do not know, so an unknown trigger cannot hide between catalogs.
- **RLS enablement**: `relrowsecurity` is inside the relation-catalog hash — `ALTER TABLE … DISABLE/ENABLE ROW LEVEL SECURITY` flips it and goes red.
- **Fail-closed baseline**: a missing or truncated catalog JSON fails parsing; an empty result fails the row-count asserts before the hash comparison — all distinct loud failures, verified by probes.
- **check-foundation pinned-evidence pairs**: every string the checker requires inside the edited harnesses is still present (verified by the checker itself).

## Observations (recorded, not defects in this slice)

- **Catalog hashes are intentionally opaque**: the verifiers pin one `sha256` over the whole catalog plus per-section counts; a legitimate new object forces a repin rather than a granular review line. That is the established design — this wave widened coverage inside the same shape.
- **Owner self-ACLs are filtered, not asserted**: implicit `arwdDxtm` owner ACLs now drop out of the runtime-privilege catalog instead of pinning ~100 noise rows; explicit privileges for the owner still surface and fail.
- **`pg_get_userbyid` naming exposes role names in diffs**: third-role statements now name the recipient role, which is the intended loudness — a deliberate readability trade-off.
- **Event-trigger coverage is database-wide**: `pg_event_trigger` has no schema column, so the array pins zero database-wide rather than schema-scoped; any future event trigger needs an explicit repin.
- **The access-control catalog must run before `postgres-runtime-privileges.sh`**: CI already orders it so — the pinned hash is only valid while `financial_core_runtime_test` does not exist, which the workflow ordering guarantees.

## Test additions

- `tests/postgres-invariant-trigger-catalog.sql` — `definition_sha256` column and `validate_posting_rule` in the function filter.
- `scripts/verify-postgres-invariant-trigger-catalog.mjs` — definition-hash comparison, `posting_rule_registry` trigger row, repinned catalog hash.
- `tests/postgres-runtime-privilege-catalog.sql` — real recipient labelling, both-direction membership rows, default-privilege recipient coverage, owner self-ACL filtering.
- `tests/postgres-relation-catalog.sql` — relkind widening plus `policies`/`publications`/`statistics`/`event_triggers` rows.
- `scripts/verify-postgres-relation-catalog.mjs` — repinned hash and empty-array pins for the four new object classes.
- `tests/postgres-access-control-catalog.sql` — real principal names and relkind widening.
- `scripts/verify-postgres-migration-source-policy.mjs` — `maskedMeta` emission, identifier-boundary guards on dollar-quotes and `E'…'` literals, `\` meta-command ban, `COPY` statement head, multi-object `TRUNCATE`/`DROP` history detection.
- `tests/postgres-migration-source-policy.sh` — five new negative fixtures (identifier-dollar-body, mislexed-E-literal, mid-line meta-command, multi-object truncate, multi-object drop).
- `tests/postgres-invariant-trigger-catalog.sh` — `assert_catalog_rejected` helper and three `WHEN (FALSE)` drift arms.
- `tests/postgres-runtime-privileges.sh` — five new arms (third-role table/function privileges, runtime-role membership, default privileges).
- `tests/postgres-access-control-catalog.sh` — three new arms (sequence, matview, third-role privilege).
- `tests/postgres-relation-catalog.sh` — `assert_catalog_rejected` helper and six object-class arms.
- `.github/scripts/verification-integrity-baseline.json` — repinned `minLines` floors for every edited harness file.

Every defect was reproduced green on the pre-fix checkers, fixed, and re-probed red; all catalog `.sh` harnesses pass end-to-end on a live `postgres:16.10` container seeded by `tests/postgres-smoke.sql`, and `check-foundation`, `check-verification-integrity`, `check-regulated-core-status` and `check-workflow-policy` are green.
