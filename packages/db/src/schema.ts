import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  halfvec,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Embedding width. Must match the model in `@dealpilot/sources` embeddings (1024 = voyage-4-lite / Qwen3-Embedding-0.6B). */
export const EMBEDDING_DIM = 1024;

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const companies = pgTable("companies", {
  cik: text("cik").primaryKey(), // 10-digit zero-padded
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  sic: text("sic"),
  sicDescription: text("sic_description"),
  fiscalYearEnd: text("fiscal_year_end"), // "MMDD"
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const filings = pgTable(
  "filings",
  {
    accession: text("accession").primaryKey(),
    cik: text("cik")
      .notNull()
      .references(() => companies.cik),
    form: text("form").notNull(),
    filed: date("filed").notNull(),
    periodOfReport: date("period_of_report"),
    url: text("url"),
    createdAt: createdAt(),
  },
  (t) => [index("filings_cik_form_idx").on(t.cik, t.form, t.filed)],
);

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["xbrl_fact", "filing_text", "market_data", "web"] }).notNull(),
  accession: text("accession"),
  form: text("form"),
  filed: date("filed"),
  url: text("url"),
  section: text("section"),
  quote: text("quote"),
  spanStart: integer("span_start"),
  spanEnd: integer("span_end"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fiscalPeriod = pgEnum("fiscal_period", ["FY", "Q1", "Q2", "Q3", "Q4", "LTM"]);

/** Reported / derived financial facts in BASE units, each tied to evidence. */
export const facts = pgTable(
  "facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cik: text("cik")
      .notNull()
      .references(() => companies.cik),
    concept: text("concept").notNull(),
    label: text("label").notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    scale: smallint("scale").notNull().default(0),
    periodStart: date("period_start"),
    periodEnd: date("period_end").notNull(),
    fiscalYear: integer("fiscal_year"),
    fiscalPeriod: fiscalPeriod("fiscal_period"),
    derived: boolean("derived").notNull().default(false),
    derivedFrom: uuid("derived_from").array().notNull().default(sql`'{}'::uuid[]`),
    restated: boolean("restated").notNull().default(false),
    originalValue: doublePrecision("original_value"),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("facts_lookup_idx").on(t.cik, t.concept, t.periodEnd),
    uniqueIndex("facts_unique_idx").on(t.cik, t.concept, t.unit, t.periodStart, t.periodEnd, t.derived),
  ],
);

/** Filing text chunks for hybrid retrieval (pgvector halfvec + Postgres full-text). */
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accession: text("accession")
      .notNull()
      .references(() => filings.accession),
    cik: text("cik").notNull(),
    section: text("section").notNull(), // 10-K Item, e.g. "7"
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    tokenCount: integer("token_count").notNull(),
    embedding: halfvec("embedding", { dimensions: EMBEDDING_DIM }),
    embeddingModel: text("embedding_model"),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', text)`),
  },
  (t) => [
    uniqueIndex("chunks_unique_idx").on(t.accession, t.section, t.ordinal),
    index("chunks_cik_idx").on(t.cik),
    index("chunks_embedding_hnsw").using("hnsw", t.embedding.op("halfvec_cosine_ops")),
    index("chunks_tsv_gin").using("gin", t.tsv),
  ],
);

export const taskStatus = pgEnum("task_status", ["queued", "running", "succeeded", "failed", "cancelled"]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticker: text("ticker").notNull(),
  request: jsonb("request").notNull(),
  status: taskStatus("status").notNull().default("queued"),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  error: text("error"),
  createdAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** Append-only audit trail of agent steps. */
export const traceEvents = pgTable(
  "trace_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    node: text("node").notNull(),
    kind: text("kind").notNull(), // "llm_call" | "tool_call" | "state_update" | "verdict" | ...
    payload: jsonb("payload").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: doublePrecision("cost_usd"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("trace_task_idx").on(t.taskId, t.createdAt)],
);

export const defects = pgTable("defects", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id),
  type: text("type").notNull(), // "calc_mismatch" | "citation_unsupported" | "period_mismatch" | ...
  ownerNode: text("owner_node").notNull(),
  detail: jsonb("detail").notNull(),
  status: text("status", { enum: ["open", "fixed", "unresolved"] })
    .notNull()
    .default("open"),
  retries: integer("retries").notNull().default(0),
  createdAt: createdAt(),
});

/** Deliverables: bytes live in Neon Object Storage (`assets` bucket); the row points at them. */
export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id),
  kind: text("kind", { enum: ["xlsx", "docx", "md", "json"] }).notNull(),
  filename: text("filename").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: createdAt(),
});

/** Generic key/value cache (market data, LLM responses in dev/evals). */
export const cache = pgTable(
  "cache",
  {
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.namespace, t.key] })],
);
