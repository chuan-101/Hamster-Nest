-- Create bubble_sessions table for daily bubble chat sessions
CREATE TABLE IF NOT EXISTS bubble_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, session_date)
);

ALTER TABLE bubble_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own bubble sessions"
  ON bubble_sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create bubble_messages table for bubble chat messages
CREATE TABLE IF NOT EXISTS bubble_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES bubble_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bubble_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own bubble messages"
  ON bubble_messages
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_bubble_sessions_user_date
  ON bubble_sessions (user_id, session_date);

CREATE INDEX IF NOT EXISTS idx_bubble_messages_session
  ON bubble_messages (session_id, created_at);
