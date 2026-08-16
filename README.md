# XXLcrm

Конструктор CRM для любого бизнеса: пользователь сам собирает разделы, поля, воронки, автоматизации и отчёты — как конструктор, но с готовыми отраслевыми шаблонами, мессенджерами и AI из коробки.

**Сайт (обёртка v0.2):** https://yoyoloxxx.github.io/xxlcrm/

## Структура

| Папка | Что это |
|---|---|
| `site/` | Основное приложение (сейчас — обёртка: все экраны, работают навигация и тема). Деплоится на GitHub Pages при каждом пуше в `main` |
| `prototype/` | Живой прототип-песочница: работающий конструктор, канбан, автоматизации, реальные интеграции Telegram / WhatsApp (Green API) / Tilda, AI по ключу |
| `docs/` | Анализ рынка и план продукта |

## Локальный запуск

```bash
cd site        # или cd prototype
npm install
npm run dev
```

Сборка: `npm run build` (Vite 8; single-file вариант — `vite build` с плагином singlefile уже настроен).

## Деплой

Пуш в `main` → GitHub Actions собирает `site/` и выкладывает на Pages автоматически. Статус — во вкладке Actions.

## Стек и решения

React 19 + TypeScript + Vite + Tailwind + shadcn/ui. Дизайн-система: yoyoloxxx Dev (Geist + Geist Mono, тёплый монохром, латунь #BC9F5C). План бэкенда: Supabase (Postgres + Auth + Realtime), metadata-driven модель — см. `docs/`.
