const https = require('https');
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYjY1ZDU3ZS1iMzdmLTQ2Y2YtYTYyMS03NGI3NDAyODYxMzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMDRiYzMyODMtNGRiNC00Y2YzLTlkZGItYWE5ZmU3MmVkZjAxIiwiaWF0IjoxNzg4MTI0NTIzfQ.X2NqdCEhxNOuy4fS3YwvB-oigCpLwPtHGkHH-1ZEiYI';
const WORKFLOW_ID = 'kIl7bPfgyQZkDivU';

const getReq = https.request({
  hostname: 'n8n.fond-hub.ru',
  path: `/api/v1/workflows/${WORKFLOW_ID}`,
  method: 'GET',
  headers: { 'X-N8N-API-KEY': API_KEY }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode !== 200) return console.log('GET Error:', res.statusCode, data);
    const wf = JSON.parse(data);
    const groqNode = wf.nodes.find(n => n.name === 'Groq API');
    if (groqNode) {
      console.log('Old URL:', groqNode.parameters.url);
      groqNode.parameters.url = 'https://groq-proxy.peroblitz.workers.dev/openai/v1/audio/transcriptions';
      console.log('New URL:', groqNode.parameters.url);
      const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: {} };
      const putReq = https.request({
        hostname: 'n8n.fond-hub.ru',
        path: `/api/v1/workflows/${WORKFLOW_ID}`,
        method: 'PUT',
        headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' }
      }, (putRes) => {
          let putData = '';
          putRes.on('data', d => putData += d);
          putRes.on('end', () => console.log("n8n update done:", putRes.statusCode, putData));
      });
      putReq.write(JSON.stringify(payload));
      putReq.end();
    } else {
      console.log('Groq API node not found');
    }
  });
});
getReq.on('error', e => console.log(e));
getReq.end();
