-- Knowledge Library: permissive Phase 1 RLS policies for anon/authenticated clients.
-- Tables may already exist in the hosted Supabase project; create missing local tables for type-safe development.
CREATE TABLE IF NOT EXISTS knowledge_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES knowledge_folders(id) ON DELETE RESTRICT,
  name text NOT NULL,
  icon text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES knowledge_folders(id) ON DELETE SET NULL,
  node_type text NOT NULL CHECK (node_type IN ('concept', 'question', 'insight', 'source', 'quote', 'note', 'application')),
  title text NOT NULL,
  content text,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  source_node_id uuid NOT NULL REFERENCES learning_nodes(id) ON DELETE CASCADE,
  target_node_id uuid NOT NULL REFERENCES learning_nodes(id) ON DELETE CASCADE,
  edge_type text NOT NULL CHECK (edge_type IN ('association', 'derivation', 'contradiction', 'application', 'reference', 'question')),
  strength integer NOT NULL DEFAULT 3 CHECK (strength BETWEEN 1 AND 5),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_loop CHECK (source_node_id <> target_node_id)
);

ALTER TABLE knowledge_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Knowledge folders anon authenticated CRUD" ON knowledge_folders;
CREATE POLICY "Knowledge folders anon authenticated CRUD"
  ON knowledge_folders
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Learning nodes anon authenticated CRUD" ON learning_nodes;
CREATE POLICY "Learning nodes anon authenticated CRUD"
  ON learning_nodes
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Learning edges anon authenticated CRUD" ON learning_edges;
CREATE POLICY "Learning edges anon authenticated CRUD"
  ON learning_edges
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_knowledge_folders_parent ON knowledge_folders (parent_id);
CREATE INDEX IF NOT EXISTS idx_learning_nodes_folder_type_created ON learning_nodes (folder_id, node_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_edges_source ON learning_edges (source_node_id);
CREATE INDEX IF NOT EXISTS idx_learning_edges_target ON learning_edges (target_node_id);
