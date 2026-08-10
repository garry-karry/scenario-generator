# Scenario Generator — деплой как Worker (не Pages)

Структура:
```
public/index.html   ← сайт (генератор + живая практика)
src/index.js         ← Worker: раздаёт public/ + обрабатывает /api/scenario-ai
wrangler.toml        ← связывает их в один деплой
```

**Провайдер ИИ: DeepSeek**, не Anthropic/Claude — примерно в 15–20 раз
дешевле за токен. Важно: это не "бесплатно навсегда" — API платный,
как и у любого провайдера, просто счёт при том же трафике будет
расходоваться намного медленнее. При регистрации на platform.deepseek.com
дают разовый грант 5 млн токенов на 30 дней, дальше — обычный
pay-as-you-go баланс.

Почему не Pages: Cloudflare сейчас объединяет Pages и Workers. Если
задеплоить как «чисто статику», у проекта не оказывается вычислительного
слоя — и вкладка Variables/Secrets попросту недоступна. Схема ниже —
настоящий Worker с кодом, поэтому секреты подключаются как обычно.

## Ключ DeepSeek

1. Зарегистрируйтесь на [platform.deepseek.com](https://platform.deepseek.com)
   — это ОТДЕЛЬНЫЙ аккаунт и баланс, не связан с console.anthropic.com.
2. API Keys → Create API Key → скопируйте (начинается с `sk-...`).
3. Billing → пополните баланс (карта нужна уже после того, как
   закончится бесплатный грант).

## Деплой через CLI (быстрее всего)

Понадобится Node.js. Из папки проекта:

```
npm install -g wrangler        # если ещё не стоит
wrangler login                 # один раз, откроет браузер для авторизации
wrangler secret put DEEPSEEK_API_KEY   # вставит ключ как секрет
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
3. Settings → **Variables and Secrets** → добавьте `DEEPSEEK_API_KEY`
   как Secret.
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

## Если позже захотите вернуть Claude

Модель, качество текста и то, насколько живо ведёт себя персонаж в
живом чате — у DeepSeek заметно скромнее, чем у Claude, особенно на
русском. Если качество окажется недостаточным, откат простой: в
`src/index.js` заменить блок `fetch("https://api.deepseek.com/...")`
обратно на `https://api.anthropic.com/v1/messages` (формат запроса
отличается — system снова отдельным полем, а не сообщением в массиве;
предыдущая версия файла с Anthropic сохранена в истории git).
