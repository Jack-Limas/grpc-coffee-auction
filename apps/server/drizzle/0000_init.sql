CREATE TYPE "public"."bid_source" AS ENUM('WEB', 'BOT', 'PROXY');--> statement-breakpoint
CREATE TYPE "public"."coffee_process" AS ENUM('WASHED', 'NATURAL', 'HONEY', 'ANAEROBIC', 'THERMAL_SHOCK');--> statement-breakpoint
CREATE TYPE "public"."lot_status" AS ENUM('SCHEDULED', 'LIVE', 'SOLD', 'UNSOLD');--> statement-breakpoint
CREATE SEQUENCE "public"."lot_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "bidders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"paddle_no" serial NOT NULL,
	"display_name" text NOT NULL,
	"company" text NOT NULL,
	"country" text NOT NULL,
	"credit_limit_cents" integer NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lot_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"paddle" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"source" "bid_source" NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"idempotency_key" text
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"variety" text NOT NULL,
	"process" "coffee_process" NOT NULL,
	"farm" text NOT NULL,
	"producer" text NOT NULL,
	"region" text NOT NULL,
	"municipality" text NOT NULL,
	"altitude_masl" integer NOT NULL,
	"sca_score" double precision NOT NULL,
	"tasting_notes" text[] NOT NULL,
	"cupped_by" text NOT NULL,
	"weight_lb" integer NOT NULL,
	"status" "lot_status" NOT NULL,
	"starting_price_cents" integer NOT NULL,
	"reserve_price_cents" integer NOT NULL,
	"current_price_cents" integer NOT NULL,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"leader_bidder_id" uuid,
	"leader_paddle" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"extension_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lots_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "proxy_bids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lot_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"paddle" text NOT NULL,
	"max_amount_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_bidders_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."bidders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_bids" ADD CONSTRAINT "proxy_bids_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_bids" ADD CONSTRAINT "proxy_bids_bidder_id_bidders_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."bidders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bidders_token_hash_idx" ON "bidders" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "bids_lot_idx" ON "bids" USING btree ("lot_id","placed_at");--> statement-breakpoint
CREATE INDEX "bids_placed_at_idx" ON "bids" USING btree ("placed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bids_idempotency_idx" ON "bids" USING btree ("bidder_id","idempotency_key") WHERE "bids"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "lots_status_idx" ON "lots" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lots_leader_idx" ON "lots" USING btree ("leader_bidder_id");--> statement-breakpoint
CREATE INDEX "proxy_bids_lot_idx" ON "proxy_bids" USING btree ("lot_id","active");