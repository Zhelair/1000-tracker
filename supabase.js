// supabase.js
// Paste your Supabase Project URL + anon public key (Project Settings → API).
// Never use service_role key in frontend.

const SUPABASE_URL = "https://qcmyfmmbdrxqjkzqtpxy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjbXlmbW1iZHJ4cWprenF0cHh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyOTA1OTIsImV4cCI6MjA4Mjg2NjU5Mn0.XxC5ISCfKExN6Yd-WK4x2dAfD9JMnGneC_urbsCow6w";

window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
