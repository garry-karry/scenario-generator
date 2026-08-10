/**
 * ══════════════════════════════════════════════════════════════════
 *  Worker: раздаёт сайт (public/) + обрабатывает /api/scenario-ai
 *  Провайдер: OpenRouter, модель openrouter/free (авто-роутер по
 *  бесплатным моделям — НЕ openrouter/auto, тот платный!).
 * ══════════════════════════════════════════════════════════════════
 *
 * Это ОДИН Worker с настоящим кодом (не "просто статика"), поэтому
 * в дашборде у него будет доступна вкладка Settings → Variables and
 * Secrets — та самая, которой не было при чисто статическом деплое.
 *
 * Локально: `npx wrangler dev`
 * Деплой:   `npx wrangler deploy`
 * Секрет:   `npx wrangler secret put OPENROUTER_API_KEY`
 *           (ключ на openrouter.ai — карта не нужна для бесплатных моделей)
 *
 * ВАЖНО про "бесплатно": лимит на бесплатные модели общий на ВЕСЬ
 * аккаунт/ключ, а не на посетителя — 50 запросов в сутки, пока не
 * пополните баланс хоть раз (после разового пополнения от $10 — уже
 * 1000/сутки). Это лимит на всех пользователей сайта суммарно. Живой
 * чат тратит несколько запросов за один диалог (открытие сцены +
 * каждая реплика + разбор в конце), так что 50/день исчерпать реально
 * быстро при активном использовании. Подробнее — в README.
 * ══════════════════════════════════════════════════════════════════
 */

const SCENARIO_AI_MODEL = "openrouter/free"; // авто-роутер по бесплатным моделям; НЕ openrouter/auto (тот платный)
const DAILY_LIMIT_PER_IP = 40; // ваш собственный лимит поверх лимита OpenRouter; работает только если подключён KV (см. wrangler.toml)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/scenario-ai") {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders() });
      }
      if (request.method === "POST") {
        return handleScenarioAI(request, env);
      }
      return json({ error: "Method not allowed" }, 405);
    }

    // всё остальное — статика из public/ (через binding ASSETS, см. wrangler.toml)
    return env.ASSETS.fetch(request);
  },
};

async function handleScenarioAI(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { system, messages, max_tokens } = body;
  if (!messages || !Array.isArray(messages)) {
    return json({ error: "messages array is required" }, 400);
  }

  if (!env.OPENROUTER_API_KEY) {
    return json({ error: "Server misconfigured: OPENROUTER_API_KEY is not set" }, 500);
  }

  if (env.SCENARIO_KV) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const allowed = await checkRateLimit(env.SCENARIO_KV, ip);
    if (!allowed) {
      return json({ error: "Daily limit reached, try again tomorrow" }, 429);
    }
  }

  const cappedMaxTokens = Math.min(Number(max_tokens) || 1200, 6000);

  // OpenRouter — OpenAI-совместимый формат: system идёт обычным
  // сообщением в начале массива messages, как у DeepSeek.
  const orMessages = system ? [{ role: "system", content: system }, ...messages] : messages;

  try {
    const orResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.OPENROUTER_API_KEY,
        "HTTP-Referer": "https://amacademy.pro", // OpenRouter просит это для атрибуции трафика; поставьте свой домен
        "X-Title": "AM Academy — Scenario Generator",
      },
      body: JSON.stringify({
        model: SCENARIO_AI_MODEL,
        max_tokens: cappedMaxTokens,
        messages: orMessages,
      }),
    });

    const data = await orResp.json();

    if (!orResp.ok) {
      const inner = (data && data.error) ? data.error : data;
      // 429 от OpenRouter на бесплатных моделях — это дневной лимит
      // (общий на весь ключ), а не разовый сбой. Помечаем это явно.
      if (orResp.status === 429) {
        return json({ error: { message: "OpenRouter free-tier daily limit reached for this key (shared across all site visitors). Try again tomorrow, or add $10 credit once to raise the limit to 1000/day.", raw: inner } }, 429);
      }
      return json({ error: inner }, orResp.status);
    }

    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    return json({ content: [{ type: "text", text }] }, 200);
  } catch (err) {
    return json({ error: "Upstream request failed", detail: String(err) }, 502);
  }
}

async function checkRateLimit(kv, ip) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `scenario-ai-count:${ip}:${today}`;
  const current = parseInt((await kv.get(key)) || "0", 10);
  if (current >= DAILY_LIMIT_PER_IP) return false;
  await kv.put(key, String(current + 1), { expirationTtl: 60 * 60 * 26 });
  return true;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
