const https = require('https');
const FormData = require('form-data');

const accountId = 'a827714c2919fe3299a0f905be2a1f88';
const token = 'cfut_YOUR_CLOUDFLARE_TOKEN_HERE';
const scriptName = 'groq-proxy';

const scriptContent = `
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
    const newRequest = new Request(url.toString(), new Request(request, {
      cf: { cacheTtl: 0 }
    }));
    let response = await fetch(newRequest);
    response = new Response(response.body, response);
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  },
};
`;

function uploadWorker() {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('metadata', JSON.stringify({
      main_module: 'worker.js'
    }), { contentType: 'application/json' });
    form.append('worker.js', scriptContent, { contentType: 'application/javascript+module' });

    const req = https.request({
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...form.getHeaders()
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        console.log('UPLOAD:', res.statusCode, data);
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    form.pipe(req);
  });
}

function enableSubdomain() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ enabled: true });
    const req = https.request({
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        console.log('SUBDOMAIN:', res.statusCode, data);
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  try {
    await uploadWorker();
    await enableSubdomain();
  } catch (e) {
    console.error(e);
  }
}

run();
