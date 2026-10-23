const https = require('https');

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYjY1ZDU3ZS1iMzdmLTQ2Y2YtYTYyMS03NGI3NDAyODYxMzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMDRiYzMyODMtNGRiNC00Y2YzLTlkZGItYWE5ZmU3MmVkZjAxIiwiaWF0IjoxNzg4MTI0NTIzfQ.X2NqdCEhxNOuy4fS3YwvB-oigCpLwPtHGkHH-1ZEiYI';
const WORKFLOW_ID = 'kIl7bPfgyQZkDivU';

const req = https.request({
  hostname: 'n8n.fond-hub.ru',
  path: `/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=10`,
  method: 'GET',
  headers: {
    'X-N8N-API-KEY': API_KEY,
    'Accept': 'application/json'
  }
}, (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const execs = parsed.data;
        console.log(`Found ${execs.length} executions`);
        execs.forEach(exec => {
            https.request({
              hostname: 'n8n.fond-hub.ru',
              path: `/api/v1/executions/${exec.id}?includeData=true`,
              method: 'GET',
              headers: {
                'X-N8N-API-KEY': API_KEY,
                'Accept': 'application/json'
              }
            }, (res2) => {
                let data2 = '';
                res2.on('data', d => data2 += d);
                res2.on('end', () => {
                    const execData = JSON.parse(data2);
                    console.log(`Execution ${exec.id} Error:`, execData.data?.resultData?.error?.message, execData.data?.resultData?.error?.description);
                });
            }).end();
        });

      } catch(e) {
        console.error("Error parsing:", e);
      }
    });
});
req.end();
