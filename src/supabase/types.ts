export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      knowledge_folders: {
        Row: {
          id: string
          parent_id: string | null
          name: string
          icon: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          parent_id?: string | null
          name: string
          icon?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          parent_id?: string | null
          name?: string
          icon?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'knowledge_folders_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'knowledge_folders'
            referencedColumns: ['id']
          },
        ]
      }
      learning_nodes: {
        Row: {
          id: string
          folder_id: string | null
          node_type: 'concept' | 'question' | 'insight' | 'source' | 'quote' | 'note' | 'application'
          title: string
          content: string | null
          tags: string[]
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          folder_id?: string | null
          node_type: 'concept' | 'question' | 'insight' | 'source' | 'quote' | 'note' | 'application'
          title: string
          content?: string | null
          tags?: string[]
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          folder_id?: string | null
          node_type?: 'concept' | 'question' | 'insight' | 'source' | 'quote' | 'note' | 'application'
          title?: string
          content?: string | null
          tags?: string[]
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'learning_nodes_folder_id_fkey'
            columns: ['folder_id']
            isOneToOne: false
            referencedRelation: 'knowledge_folders'
            referencedColumns: ['id']
          },
        ]
      }
      learning_edges: {
        Row: {
          id: string
          from_node_id: string
          to_node_id: string
          edge_type: 'association' | 'derivation' | 'contradiction' | 'application' | 'reference' | 'question'
          strength: number
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          from_node_id: string
          to_node_id: string
          edge_type: 'association' | 'derivation' | 'contradiction' | 'application' | 'reference' | 'question'
          strength?: number
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          from_node_id?: string
          to_node_id?: string
          edge_type?: 'association' | 'derivation' | 'contradiction' | 'application' | 'reference' | 'question'
          strength?: number
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'learning_edges_from_node_id_fkey'
            columns: ['from_node_id']
            isOneToOne: false
            referencedRelation: 'learning_nodes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'learning_edges_to_node_id_fkey'
            columns: ['to_node_id']
            isOneToOne: false
            referencedRelation: 'learning_nodes'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
