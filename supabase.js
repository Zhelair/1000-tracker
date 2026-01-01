// supabase.js
// 1) Paste your Supabase URL + anon key below
// 2) Keep this file in repo root
// NOTE: NEVER use service_role key in frontend.

const SUPABASE_URL = "PASTE_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_SUPABASE_ANON_KEY_HERE";

window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
