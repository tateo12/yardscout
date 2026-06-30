import { createClient } from "@supabase/supabase-js";

// The anon key is PUBLIC by design (it ships in the client bundle and is protected by RLS).
// Never put the service_role / secret key here.
const SUPABASE_URL = "https://jjgvnokimqhqdvcmyxnm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqZ3Zub2tpbXFocWR2Y215eG5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4Mjc5NjUsImV4cCI6MjA5ODQwMzk2NX0.yJxxFBlDD_OfQGuYjZWeVeVe0Gq4pO8Hw67oMzE5p6E";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
