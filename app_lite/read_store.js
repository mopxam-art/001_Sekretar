const { app } = require('electron');
const Store = require('electron-store');
const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');

app.whenReady().then(() => {
  const store = new Store({
    name: 'pero-blitz-config' // имя базы данных старого app_lite
  });

  const hwid = machineIdSync();
  const encryptionKey = crypto.createHash('sha256').update(hwid + 'pero-blitz-salt-v1').digest('hex');

  const secureStore = new Store({
    name: 'pero-blitz-config',
    encryptionKey: encryptionKey,
    clearInvalidConfig: false
  });

  console.log("=== TOKENS ===");
  try {
    const decTokens = secureStore.get('tokens');
    console.log(JSON.stringify(decTokens));
  } catch (e) {
    console.log("Err:", e);
  }
  
  console.log("=== UNENCRYPTED TOKENS ===");
  try {
    const decTokens = store.get('tokens');
    console.log(JSON.stringify(decTokens));
  } catch (e) {
    console.log("Err:", e);
  }
  
  app.quit();
});
