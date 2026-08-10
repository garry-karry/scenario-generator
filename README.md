# Scenario Generator — деплой как Worker (не Pages)

Структура:
```
public/index.html   ← сайт (генератор + живая практика)
src/index.js         ← Worker: раздаёт public/ + обрабатывает /api/scenario-ai
wrangler.toml        ← связывает их в один деплой
```

Почему не Pages: Cloudflare сейчас объединяет Pages и Workers. Если
задеплоить как «чисто статику» (как было раньше через Pages без
распознанного Worker-скрипта), у проекта не оказывается вычислительного
слоя — и вкладка Variables/Secrets попросту недоступна («Variables
cannot be added to a Worker that only has static assets»). Схема ниже —
это уже настоящий Worker с кодом, поэтому секреты подключаются как
обычно.

## Деплой через CLI (быстрее всего)

Понадобится Node.js. Из папки проекта:

```
npm install -g wrangler        # если ещё не стоит
wrangler login                 # один раз, откроет браузер для авторизации
wrangler secret put ANTHROPIC_API_KEY   # вставит ключ как секрет
wrangler deploy
```

После `wrangler deploy` сайт будет доступен по адресу вида
`scenario-generator.<ваш-субдомен>.workers.dev` — бесплатно, без
покупки домена.

## Если хотите автодеплой из GitHub (как у amacademy.pro)

1. Запушьте эту папку целиком (`public/`, `src/`, `wrangler.toml`) в
   репозиторий на GitHub.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** →
   **Workers** (не Pages) → **Connect to Git** → выберите репозиторий.
   Cloudflare увидит `wrangler.toml` и настроится сам.
3. Settings → **Variables and Secrets** → добавьте `ANTHROPIC_API_KEY`
   как Secret. Эта вкладка теперь будет доступна, так как проект — уже
   Worker с кодом, а не чистая статика.
4. Redeploy, если переменная не подхватилась сразу.

## Свой домен позже

Тот же принцип, что раньше: в настройках Worker → **Triggers** →
**Custom domains** → добавьте, например, `scenarios.amacademy.pro`.
Домен уже у вас в Cloudflare — покупать ничего не нужно.

## Лимит запросов в сутки (опционально)

1. `wrangler kv namespace create SCENARIO_KV` — покажет `id`.
2. Впишите этот `id` в `wrangler.toml`, раскомментировав блок
   `[[kv_namespaces]]`.
3. `wrangler deploy` ещё раз.

Без этого шага лимит просто не работает — код обрабатывает отсутствие
KV-биндинга мягко, ничего не ломается.
