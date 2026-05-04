CREATE TABLE launched_tokens (
  id SERIAL PRIMARY KEY,
  token_address TEXT NOT NULL UNIQUE,
  reactor_address TEXT NOT NULL,
  launcher_address TEXT NOT NULL,
  upstream_address TEXT,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  supply TEXT NOT NULL,
  seed TEXT NOT NULL,
  factory_address TEXT NOT NULL,
  chain_id INTEGER DEFAULT 8453,
  block_number BIGINT,
  tx_hash TEXT,
  launched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE launched_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON launched_tokens FOR SELECT USING (true);
CREATE POLICY "Allow service insert" ON launched_tokens FOR INSERT WITH CHECK (true);
