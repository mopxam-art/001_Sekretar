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
    const wf = JSON.parse(data);
    const groqNode = wf.nodes.find(n => n.name === 'Groq API');
    if (groqNode) {
      const headerParams = groqNode.parameters.headerParameters.parameters;
      const authHeader = headerParams.find(p => p.name === 'Authorization');
      if (authHeader && authHeader.value.startsWith('=')) {
        console.log('Fixing header value:', authHeader.value);
        authHeader.value = authHeader.value.replace(/^=/, '');
        console.log('New header value:', authHeader.value);
      }
      
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
    }
  });
});
getReq.end();
