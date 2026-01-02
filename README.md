# 1000-tracker (rooms + realtime)

A tiny shared scoreboard for the Russian card game **Тысяча** (1000).

## Setup
1) Create Supabase project
2) Run SQL tables (rooms, players, rules, rounds, totals)
3) Enable Realtime for those tables
4) For MVP: disable RLS (or add permissive policies)
5) Paste Project URL + anon key into `supabase.js`

## Run
Open `index.html` via GitHub Pages.

## Notes
- No accounts, no installs.
- Rooms sync on multiple devices via Supabase Realtime.


## Если видишь ошибки про SUPABASE_* / supabaseClient missing

1) Открой в браузере напрямую:
- /supabase.js (должны быть твои URL и anon key, не заглушки)

2) Сделай hard refresh:
- Windows: Ctrl + Shift + R
- или открой в Incognito

3) Убедись, что Project URL начинается с https:// и заканчивается .supabase.co
