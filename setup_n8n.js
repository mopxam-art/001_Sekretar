const https = require('https');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYjY1ZDU3ZS1iMzdmLTQ2Y2YtYTYyMS03NGI3NDAyODYxMzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMDRiYzMyODMtNGRiNC00Y2YzLTlkZGItYWE5ZmU3MmVkZjAxIiwiaWF0IjoxNzg4MTI0NTIzfQ.X2NqdCEhxNOuy4fS3YwvB-oigCpLwPtHGkHH-1ZEiYI';
const API_URL = 'https://n8n.fond-hub.ru/api/v1/workflows';

const workflowJson = {
  "name": "Pero Blitz - Groq Proxy",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "transcribe",
        "responseMode": "lastNode",
        "options": {}
      },
      "id": "webhook-transcribe",
      "name": "Webhook (Transcribe)",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [200, 300],
      "webhookId": "peroblitz-transcribe-123"
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.groq.com/openai/v1/audio/transcriptions",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "={{$node[\"Webhook (Transcribe)\"].parameter[\"headers\"][\"authorization\"]}}"
            }
          ]
        },
        "sendBody": true,
        "contentType": "multipart-form-data",
        "bodyParameters": {
          "parameters": [
            {
              "name": "model",
              "value": "whisper-large-v3-turbo"
            },
            {
              "name": "response_format",
              "value": "json"
            }
          ]
        },
        "sendBinaryData": true,
        "binaryPropertyName": "data",
        "options": {}
      },
      "id": "http-groq",
      "name": "Groq API",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.1,
      "position": [450, 300]
    }
  ],
  "connections": {
    "Webhook (Transcribe)": {
      "main": [
        [
          {
            "node": "Groq API",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "settings": {}
};

const reqOptions = {
  hostname: 'n8n.fond-hub.ru',
  path: '/api/v1/workflows',
  method: 'POST',
  headers: {
    'X-N8N-API-KEY': API_KEY,
    'Content-Type': 'application/json'
  }
};

const req = https.request(reqOptions, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Body: ${data}`);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(JSON.stringify(workflowJson));
req.end();
