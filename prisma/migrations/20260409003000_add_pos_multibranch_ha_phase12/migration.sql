ALTER TABLE "pos_sessions"
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "recoverySnapshot" JSONB;

ALTER TABLE "pos_terminals"
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "heartbeatMeta" JSONB;
