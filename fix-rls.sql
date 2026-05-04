-- Run in Supabase Dashboard > SQL Editor
-- Project: hhniimufxjjgmessjtbc
-- Fixes: anon key can currently INSERT fake tokens into launched_tokens

DROP POLICY "Allow service insert" ON launched_tokens;
CREATE POLICY "Allow service insert" ON launched_tokens FOR INSERT TO service_role WITH CHECK (true);
