import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "shared_link_view" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "sharedLinkId" uuid NOT NULL,
  "visitorHash" bytea NOT NULL,
  "viewDate" date NOT NULL,
  "viewCount" integer NOT NULL DEFAULT 1,
  CONSTRAINT "shared_link_view_sharedLinkId_fkey" FOREIGN KEY ("sharedLinkId") REFERENCES "shared_link" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "shared_link_view_sharedLinkId_visitorHash_viewDate_uq" UNIQUE ("sharedLinkId", "visitorHash", "viewDate"),
  CONSTRAINT "shared_link_view_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "shared_link_view_sharedLinkId_idx" ON "shared_link_view" ("sharedLinkId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "shared_link_view";`.execute(db);
}
