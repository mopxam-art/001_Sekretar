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
      // Fix 1: Ensure URL is correct
      groqNode.parameters.url = 'https://gateway.ai.cloudflare.com/v1/a827714c2919fe3299a0f905be2a1f88/peroblitz/groq/openai/v1/audio/transcriptions';
      
      // Fix 2: Ensure Auth Header has '=' if it is an expression
      const authHeader = groqNode.parameters.headerParameters?.parameters?.find(p => p.name === 'Authorization');
      if (authHeader && !authHeader.value.startsWith('=')) {
        if (authHeader.value.includes('{{')) {
          authHeader.value = '=' + authHeader.value;
        }
      }

      // Fix 3: Body Parameters - Form Data setup
      groqNode.parameters.sendBody = true;
      groqNode.parameters.contentType = 'multipart-form-data';
      
      // Fix binary parameter correctly
      groqNode.parameters.bodyParameters = {
        parameters: [
          {
            name: "model",
            value: "whisper-large-v3-turbo"
          },
          {
            name: "response_format",
            value: "json"
          },
          {
            parameterType: "formBinaryData",
            name: "file",
            inputDataFieldName: "file" // The webhook is actually outputting the binary data in 'file' property
          }
        ]
      };
      
      // Clean up legacy sendBinaryData which conflicts with bodyParameters in newer n8n versions
      delete groqNode.parameters.sendBinaryData;
      delete groqNode.parameters.binaryPropertyName;
      
      console.log('Fixed Groq Node Parameters:', JSON.stringify(groqNode.parameters, null, 2));

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
