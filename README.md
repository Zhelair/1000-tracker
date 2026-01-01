# 1000-tracker (Holiday Harmony clean)

Это веб‑приложение для подсчёта очков в «Тысяче»:
- комнаты по коду (как HH)
- синхронизация на 3 устройствах (Supabase Realtime)
- вкладки: Правила / Счёт / История / График
- правила комнаты «закрепляются» после согласия 3 игроков

## Setup
1) В `supabase.js` вставьте Project URL и anon public key (Supabase → Project Settings → API)
2) Убедитесь, что Realtime включен для таблиц: rooms, players, rules, rounds, totals
3) Деплой на GitHub Pages

## Примечание про RLS
Для быстрого MVP можно отключить RLS на этих таблицах (позже добавим простую защиту по room code).
