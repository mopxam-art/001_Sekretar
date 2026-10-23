/**
 * Obfuscation script — Pero Blitz
 * Copies electron/ and groqService.js → electron-obf/
 * Obfuscates the copies. electron-builder uses electron-obf/.
 */

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_ELECTRON = path.join(ROOT, 'electron');
const SRC_GROQ = path.join(ROOT, 'groqService.js');
const DST_ELECTRON = path.join(ROOT, 'electron-obf');
const DST_GROQ = path.join(ROOT, 'groqService-obf.js');

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: true,
  debugProtectionInterval: 4000,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

function copyDir(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const dstPath = path.join(dst, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function getAllJsFiles(dir) {
  let results = [];
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      results = results.concat(getAllJsFiles(fullPath));
    } else if (file.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function obfuscateFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  if (code.length < 50) {
    console.log(`  SKIP (too small): ${path.relative(ROOT, filePath)}`);
    return;
  }
  try {
    const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS);
    fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
    console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
  } catch (err) {
    console.warn(`  ⚠ FAILED ${path.relative(ROOT, filePath)}: ${err.message}`);
  }
}

console.log('\n🔒 Pero Blitz — Code Protection\n');

// Clean old obfuscated output
if (fs.existsSync(DST_ELECTRON)) fs.rmSync(DST_ELECTRON, { recursive: true });

// Copy electron/ → electron-obf/
console.log('📋 Copying electron/ → electron-obf/');
copyDir(SRC_ELECTRON, DST_ELECTRON);

// Copy groqService.js → groqService-obf.js
if (fs.existsSync(SRC_GROQ)) {
  fs.copyFileSync(SRC_GROQ, DST_GROQ);
}

// Obfuscate all JS in electron-obf/
const files = getAllJsFiles(DST_ELECTRON);
console.log(`\n🔐 Obfuscating ${files.length} files in electron-obf/\n`);
files.forEach(obfuscateFile);

// Obfuscate groqService-obf.js
if (fs.existsSync(DST_GROQ)) {
  console.log('\n🔐 Obfuscating groqService.js');
  obfuscateFile(DST_GROQ);
}

console.log('\n✅ Protection complete. Ready for electron-builder.\n');
