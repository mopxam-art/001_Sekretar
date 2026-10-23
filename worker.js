export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        }
      });
    }
    url.hostname = "api.groq.com";
    
    const newHeaders = new Headers(request.headers);
    newHeaders.delete("CF-Connecting-IP");
    newHeaders.delete("CF-IPCountry");
    newHeaders.delete("X-Forwarded-For");
    newHeaders.delete("X-Real-IP");
    newHeaders.delete("True-Client-IP");

    const newRequest = new Request(url.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: request.redirect,
      cf: { cacheTtl: 0 }
    });
    
    let response = await fetch(newRequest);
    response = new Response(response.body, response);
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  },
};
