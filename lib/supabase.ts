import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

// Server-side Supabase client — uses service role key if available for full DB access
export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");

    const key = serviceKey || anonKey;
    if (!key) throw new Error("No Supabase key available (SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)");

    _supabase = createClient(url, key);
  }
  return _supabase;
}

// Client-side singleton — always uses anon key
let _clientSupabase: SupabaseClient | null = null;

export function getClientSupabase(): SupabaseClient {
  if (!_clientSupabase) {
    _clientSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _clientSupabase;
}
