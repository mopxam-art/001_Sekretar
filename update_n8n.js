const https = require('https');
const path = require('path');

// Инициализируем Store от оригинального app_lite чтобы вытащить ключ
const groqKey = 'gsk_YOUR_GROQ_API_KEY_HERE';

console.log("Updating n8n...");

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYjY1ZDU3ZS1iMzdmLTQ2Y2YtYTYyMS03NGI3NDAyODYxMzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMDRiYzMyODMtNGRiNC00Y2YzLTlkZGItYWE5ZmU3MmVkZjAxIiwiaWF0IjoxNzg4MTI0NTIzfQ.X2NqdCEhxNOuy4fS3YwvB-oigCpLwPtHGkHH-1ZEiYI';
const WORKFLOW_ID = 'kIl7bPfgyQZkDivU';

// Сначала получаем текущий workflow
const getReq = https.request({
  hostname: 'n8n.fond-hub.ru',
  path: `/api/v1/workflows/${WORKFLOW_ID}`,
  method: 'GET',
  headers: {
    'X-N8N-API-KEY': API_KEY
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200) {
      const wf = JSON.parse(data);
      
      // Находим ноду Groq API
      const groqNode = wf.nodes.find(n => n.name === 'Groq API');
      if (groqNode) {
        // Меняем data на file
        groqNode.parameters.binaryPropertyName = 'file';
        
        // Создаем чистый payload для апдейта
        const payload = {
          name: wf.name,
          nodes: wf.nodes,
          connections: wf.connections,
          settings: {} // Пустой объект, чтобы API не ругался на лишние свойства
        };

        console.log("Sending PUT request with payload keys:", Object.keys(payload));

        // Отправляем обновленный workflow обратно
        const putReq = https.request({
          hostname: 'n8n.fond-hub.ru',
          path: `/api/v1/workflows/${WORKFLOW_ID}`,
          method: 'PUT',
          headers: {
            'X-N8N-API-KEY': API_KEY,
            'Content-Type': 'application/json'
          }
        }, (putRes) => {
            let putData = '';
            putRes.on('data', d => putData += d);
            putRes.on('end', () => {
              console.log("Update status:", putRes.statusCode);
              console.log("Update response:", putData);
            });
        });
        putReq.write(JSON.stringify(payload));
        putReq.end();
      }
    } else {
      console.log("GET error:", res.statusCode, data);
    }
  });
});

getReq.end();
