const https = require('https');

const apiKey = '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';

const reqOptions = {
  hostname: 'gateway.ai.cloudflare.com',
  path: '/v1/a827714c2919fe3299a0f905be2a1f88/peroblitz/groq/openai/v1/models',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${apiKey}`
  },
};

const req = https.request(reqOptions, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Body: ${data}`);
  });
});

req.on('error', (e) => console.error(e));
req.end();
