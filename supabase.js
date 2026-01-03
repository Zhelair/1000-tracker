// supabase.js
// Публичные значения (Project URL + anon public key) можно хранить во фронтенде.
// Вставь значения из Supabase → Project Settings → API.
//
// Важно: этот файл специально написан так, чтобы НЕ падать “ReferenceError”,
// даже если ты случайно переименовал переменные при вставке.

(function () {
  // Preferred: edit these two lines
  const EDIT_SUPABASE_URL = "PASTE_SUPABASE_URL_HERE";
  const EDIT_SUPABASE_ANON_KEY = "PASTE_SUPABASE_ANON_KEY_HERE";

  // Fallbacks (in case user pasted globals without const, or older builds)
  const legacyUrl = (typeof SUPABASE_URL !== "undefined") ? SUPABASE_URL : undefined;
  const legacyAnon = (typeof SUPABASE_ANON_KEY !== "undefined") ? SUPABASE_ANON_KEY : undefined;
  const cfg = (window.__SUPABASE_CONFIG && typeof window.__SUPABASE_CONFIG === "object") ? window.__SUPABASE_CONFIG : {};

  const url =
    (legacyUrl && String(legacyUrl)) ||
    (cfg.url && String(cfg.url)) ||
    EDIT_SUPABASE_URL;

  const anon =
    (legacyAnon && String(legacyAnon)) ||
    (cfg.anon && String(cfg.anon)) ||
    EDIT_SUPABASE_ANON_KEY;

  const looksLikePlaceholder = (v) => !v || String(v).includes("PASTE_SUPABASE_");

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Supabase SDK not loaded. Check the CDN script in index.html");
    return;
  }

  if (looksLikePlaceholder(url) || !/^https?:\/\//i.test(url)) {
    console.error("SUPABASE_URL is missing or invalid. Paste Project URL (must start with https://) into supabase.js.");
    return;
  }
  if (looksLikePlaceholder(anon) || String(anon).length < 20) {
    console.error("SUPABASE_ANON_KEY is missing/too short. Paste anon public key into supabase.js.");
    return;
  }

  window.supabaseClient = window.supabase.createClient(url.trim(), anon.trim());
})();
