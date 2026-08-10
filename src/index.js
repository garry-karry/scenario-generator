/**
 * ══════════════════════════════════════════════════════════════════
 *  Worker: раздаёт сайт (public/) + обрабатывает /api/scenario-ai
 *  Провайдер: DeepSeek (OpenAI-совместимый API), не Anthropic.
 * ══════════════════════════════════════════════════════════════════
 *
 * Это ОДИН Worker с настоящим кодом (не "просто статика"), поэтому
 * в дашборде у него будет доступна вкладка Settings → Variables and
 * Secrets — та самая, которой не было при чисто статическом деплое.
 *
 * Локально: `npx wrangler dev`
 * Деплой:   `npx wrangler deploy`
 * Секрет:   `npx wrangler secret put DEEPSEEK_API_KEY`
 *           (ключ берётся на platform.deepseek.com — это ОТДЕЛЬНЫЙ
 *           аккаунт/баланс, не связан с Anthropic/console.anthropic.com)
 * ══════════════════════════════════════════════════════════════════
 */

const SCENARIO_AI_MODEL = "deepseek-chat"; // V3.2, без "размышлений" — быстрее и дешевле; deepseek-reasoner для более сложных сценариев
const DAILY_LIMIT_PER_IP = 40; // подберите под бюджет; работает только если подключён KV (см. wrangler.toml)

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

  if (!env.DEEPSEEK_API_KEY) {
    return json({ error: "Server misconfigured: DEEPSEEK_API_KEY is not set" }, 500);
  }

  if (env.SCENARIO_KV) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const allowed = await checkRateLimit(env.SCENARIO_KV, ip);
    if (!allowed) {
      return json({ error: "Daily limit reached, try again tomorrow" }, 429);
    }
  }

  const cappedMaxTokens = Math.min(Number(max_tokens) || 1200, 6000);

  // DeepSeek — OpenAI-совместимый формат: system идёt как ОБЫЧНОЕ сообщение
  // в начале массива messages (у Anthropic это было отдельное поле "system").
  const dsMessages = system ? [{ role: "system", content: system }, ...messages] : messages;

  try {
    const dsResp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
      },
      body: JSON.stringify({
        model: SCENARIO_AI_MODEL,
        max_tokens: cappedMaxTokens,
        messages: dsMessages,
        stream: false,
      }),
    });

    const data = await dsResp.json();

    if (!dsResp.ok) {
      // DeepSeek возвращает { error: { message, type, code } }
      const inner = (data && data.error) ? data.error : data;
      return json({ error: inner }, dsResp.status);
    }

    // Нормализуем OpenAI-формат ответа в тот же вид, что фронтенд уже
    // умеет разбирать (content: [{type:'text', text: '...'}]), чтобы
    // не трогать код на странице.
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
