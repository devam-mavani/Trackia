import { createClient } from "@supabase/supabase-js";

/* ---------------------------------------------------------------------- */
/*  Supabase project config                                                */
/*                                                                          */
/*  1. Create a free project at https://supabase.com                      */
/*  2. Run supabase.sql (repo root) in its SQL editor — this creates the   */
/*     `entries` table, the `covers` storage bucket, and the Row Level     */
/*     Security policies that keep each user's data private to them.      */
/*  3. Paste your project's URL and anon (public) key below. Both are     */
/*     safe to ship inside the app — they only grant what the RLS         */
/*     policies in supabase.sql allow, never raw table access.            */
/*     Settings → API in your Supabase project dashboard.                 */
/* ---------------------------------------------------------------------- */
const SUPABASE_URL = "https://spghdghrwwdipvsrzwwr.supabase.co";

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwZ2hkZ2hyd3dkaXB2c3J6d3dyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0NzYxMzEsImV4cCI6MjEwNjA1MjEzMX0.JDL2g-kvweR0N8Pwu9RUqbBgf0O9Mdqn6QGX0YnyrI8";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // No magic-link/OAuth redirect handling needed inside the packaged
    // Android app — email+password only, so this stays off.
    detectSessionInUrl: false,
  },
});

export const COVERS_BUCKET = "covers";
