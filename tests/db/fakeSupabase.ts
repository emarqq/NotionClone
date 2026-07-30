/**
 * A tiny in-memory stand-in for the PostgREST query builder that
 * `createServiceSupabase()` returns.
 *
 * It exists so the reconciliation logic in `lib/db/blocks.ts` — which is a
 * verified data-loss path (CODE_REVIEW §E1/§E3/§E6) — can be unit-tested from a
 * sandboxed session with no Docker and no Postgres. It deliberately models only
 * the handful of chains that `lib/db/*` actually builds; it is **not** a
 * PostgREST emulator, and anything it does not understand throws loudly rather
 * than silently returning an empty result, so a future refactor that changes the
 * query shape fails the test instead of passing vacuously.
 *
 * The real behaviour still has to be verified against Postgres (roadmap A4 moves
 * this whole reconcile into a single transactional RPC, which is where the
 * integration test belongs — see `tests/db/hybridSearch.test.ts` for the
 * disposable-container pattern).
 */

export type Row = Record<string, unknown>;

interface Postgrestish<T> {
  data: T | null;
  error: { message: string } | null;
}

type Op = "select" | "upsert" | "update" | "delete";

interface Filter {
  kind: "eq" | "in";
  column: string;
  value: unknown;
  values?: unknown[];
}

export interface FakeSupabaseOptions {
  /**
   * Force a specific operation to fail, so error propagation is testable.
   * Matched on `${table}.${op}`, e.g. `"blocks.upsert"`.
   */
  failOn?: Record<string, string>;
}

export interface FakeSupabase {
  from(table: string): Builder;
  /** Current contents of a table, for assertions. */
  rows(table: string): Row[];
  /** Every chain that was executed, in order, as `table.op`. */
  readonly calls: string[];
}

class Builder implements PromiseLike<Postgrestish<Row[]>> {
  private op: Op = "select";
  private filters: Filter[] = [];
  private payload: Row[] = [];
  private patch: Row = {};
  /** Column list the caller asked for, kept so a test can assert the query shape. */
  selected: string | undefined;

  constructor(
    private readonly db: Map<string, Row[]>,
    private readonly table: string,
    private readonly calls: string[],
    private readonly failOn: Record<string, string>
  ) {}

  select(columns?: string): this {
    this.op = "select";
    this.selected = columns;
    return this;
  }

  upsert(rows: Row[], opts?: { onConflict?: string }): this {
    if (opts?.onConflict !== undefined && opts.onConflict !== "id") {
      throw new Error(`fakeSupabase: unsupported onConflict "${opts.onConflict}"`);
    }
    this.op = "upsert";
    this.payload = rows;
    return this;
  }

  update(patch: Row): this {
    this.op = "update";
    this.patch = patch;
    return this;
  }

  delete(): this {
    this.op = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: "in", column, value: undefined, values });
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) =>
      f.kind === "eq" ? row[f.column] === f.value : f.values!.includes(row[f.column])
    );
  }

  private run(): Postgrestish<Row[]> {
    const key = `${this.table}.${this.op}`;
    this.calls.push(key);

    const message = this.failOn[key];
    if (message) return { data: null, error: { message } };

    const table = this.db.get(this.table) ?? [];

    switch (this.op) {
      case "select":
        return { data: table.filter((r) => this.matches(r)).map((r) => ({ ...r })), error: null };

      case "upsert": {
        for (const incoming of this.payload) {
          const i = table.findIndex((r) => r.id === incoming.id);
          if (i >= 0) table[i] = { ...table[i], ...incoming };
          else table.push({ ...incoming });
        }
        this.db.set(this.table, table);
        return { data: null, error: null };
      }

      case "update": {
        for (const row of table) if (this.matches(row)) Object.assign(row, this.patch);
        return { data: null, error: null };
      }

      case "delete": {
        if (this.filters.length === 0) {
          // An unfiltered delete is exactly the class of bug this suite guards
          // against; never let one pass silently.
          throw new Error("fakeSupabase: refusing an unfiltered delete");
        }
        this.db.set(
          this.table,
          table.filter((r) => !this.matches(r))
        );
        return { data: null, error: null };
      }
    }
  }

  then<R1 = Postgrestish<Row[]>, R2 = never>(
    onfulfilled?: ((v: Postgrestish<Row[]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    let result: Postgrestish<Row[]>;
    try {
      result = this.run();
    } catch (err) {
      return Promise.reject(err).then(onfulfilled as never, onrejected);
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

export function createFakeSupabase(
  initial: Record<string, Row[]> = {},
  options: FakeSupabaseOptions = {}
): FakeSupabase {
  const db = new Map<string, Row[]>(
    Object.entries(initial).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))])
  );
  const calls: string[] = [];
  const failOn = options.failOn ?? {};

  return {
    from: (table) => new Builder(db, table, calls, failOn),
    rows: (table) => (db.get(table) ?? []).map((r) => ({ ...r })),
    calls,
  };
}
