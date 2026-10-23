/**
 * Cloudflare Worker Proxy для Перо Блиц (Замена N8N)
 * 
 * Инструкция по установке:
 * 1. Зарегистрируйтесь на Cloudflare (cloudflare.com)
 * 2. Перейдите в раздел Workers & Pages -> Create Application -> Create Worker
 * 3. Назовите его (например, pero-blitz-proxy) и нажмите Deploy
 * 4. Нажмите Edit Code и вставьте этот код вместо стандартного
 * 5. Нажмите Deploy
 * 6. ПРИМЕЧАНИЕ ДЛЯ РФ: Домены *.workers.dev могут блокироваться в России. 
 *    Обязательно привяжите свой собственный домен во вкладке Settings -> Triggers -> Custom Domains!
 */

export default {
  async fetch(request, env, ctx) {
    // Разрешаем только POST запросы
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    let targetUrl = "";

    // Маппинг путей N8N на реальные пути Groq API
    if (path === "/webhook/transcribe") {
      targetUrl = "https://api.groq.com/openai/v1/audio/transcriptions";
    } else if (path === "/webhook/chat") {
      targetUrl = "https://api.groq.com/openai/v1/chat/completions";
    } else {
      return new Response("Not found", { status: 404 });
    }

    // Создаем новый запрос к Groq API, копируя все заголовки и тело
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "follow"
    });

    try {
      const response = await fetch(newRequest);
      
      // Возвращаем ответ от Groq клиенту (Перо Блиц)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (e) {
      return new Response(e.message, { status: 500 });
    }
  }
};
