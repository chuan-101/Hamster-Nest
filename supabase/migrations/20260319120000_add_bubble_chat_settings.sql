-- Add bubble chat settings columns to user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS bubble_chat_model text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bubble_chat_system_prompt text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bubble_chat_max_tokens integer DEFAULT 200,
  ADD COLUMN IF NOT EXISTS bubble_chat_temperature double precision DEFAULT 0.8;
