// supabase.js
// Paste your values from Supabase → Project Settings → API
const SUPABASE_URL = "PASTE_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_SUPABASE_ANON_KEY_HERE";

if (!window.supabase) {
  console.error("Supabase SDK not loaded. Check the CDN script in index.html");
}

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
