CREATE TYPE "public"."fiscal_period" AS ENUM('FY', 'Q1', 'Q2', 'Q3', 'Q4', 'LTM');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cache" (
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cache_namespace_key_pk" PRIMARY KEY("namespace","key")
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accession" text NOT NULL,
	"cik" text NOT NULL,
	"section" text NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" halfvec(1024),
	"embedding_model" text,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"cik" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"sic" text,
	"sic_description" text,
	"fiscal_year_end" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"type" text NOT NULL,
	"owner_node" text NOT NULL,
	"detail" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"accession" text,
	"form" text,
	"filed" date,
	"url" text,
	"section" text,
	"quote" text,
	"span_start" integer,
	"span_end" integer,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cik" text NOT NULL,
	"concept" text NOT NULL,
	"label" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"scale" smallint DEFAULT 0 NOT NULL,
	"period_start" date,
	"period_end" date NOT NULL,
	"fiscal_year" integer NOT NULL,
	"fiscal_period" "fiscal_period" NOT NULL,
	"derived" boolean DEFAULT false NOT NULL,
	"derived_from" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"restated" boolean DEFAULT false NOT NULL,
	"original_value" double precision,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filings" (
	"accession" text PRIMARY KEY NOT NULL,
	"cik" text NOT NULL,
	"form" text NOT NULL,
	"filed" date NOT NULL,
	"period_of_report" date,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"request" jsonb NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trace_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"node" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_accession_filings_accession_fk" FOREIGN KEY ("accession") REFERENCES "public"."filings"("accession") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_cik_companies_cik_fk" FOREIGN KEY ("cik") REFERENCES "public"."companies"("cik") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_cik_companies_cik_fk" FOREIGN KEY ("cik") REFERENCES "public"."companies"("cik") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_unique_idx" ON "chunks" USING btree ("accession","section","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_cik_idx" ON "chunks" USING btree ("cik");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "chunks" USING hnsw ("embedding" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_tsv_gin" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "facts_lookup_idx" ON "facts" USING btree ("cik","concept","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "facts_unique_idx" ON "facts" USING btree ("cik","concept","unit","period_start","period_end","derived");--> statement-breakpoint
CREATE INDEX "filings_cik_form_idx" ON "filings" USING btree ("cik","form","filed");--> statement-breakpoint
CREATE INDEX "trace_task_idx" ON "trace_events" USING btree ("task_id","created_at");