/**
 * Чистый билдер GPU-контекста для Sentry (Шаг 3). Тестируется в Node без Electron.
 *
 * Половина крашей 0xC0000005 связана с GPU/драйвером — обогащаем краши моделью/
 * вендором/версией. ⚠️ Только структурные whitelisted-поля — БЕЗ путей с
 * юзернеймом (PII). Поля Chromium GPUInfo нестабильны между версиями, поэтому
 * достаём аккуратно и терпим отсутствие.
 */

/**
 * Нормализует сырой app.getGPUInfo('complete') в компактный безопасный объект.
 * vendorId/deviceId — поля ЭЛЕМЕНТА gpuDevice[] (НЕ top-level).
 */
function normalizeGpuInfo(info) {
  if (!info || typeof info !== 'object') return {};
  const devices = Array.isArray(info.gpuDevice) ? info.gpuDevice : [];
  const d = devices.find((x) => x && x.active) || devices[0] || {};
  const aux = info.auxAttributes && typeof info.auxAttributes === 'object' ? info.auxAttributes : {};
  const out = {
    model: d.deviceString || d.vendorString,
    vendorId: d.vendorId,
    deviceId: d.deviceId,
    machineModel: info.machineModelName,
    glVersion: aux.glVersion,
    glRenderer: aux.glRenderer,
    softwareRendering: aux.softwareRendering,
  };
  const clean = {};
  for (const [k, v] of Object.entries(out)) {
    if (v !== undefined && v !== null) clean[k] = v;
  }
  return clean;
}

/**
 * Собирает финальный контекст: нормализованный (async-кэш) GPUInfo + sync
 * featureStatus. getFeatureStatus обёрнут — часть драйверов бросает.
 */
function buildGpuContext(cachedGpu, getFeatureStatus) {
  const ctx = { ...(cachedGpu || {}) };
  try {
    if (typeof getFeatureStatus === 'function') {
      const fs = getFeatureStatus();
      if (fs && typeof fs === 'object' && Object.keys(fs).length > 0) ctx.featureStatus = fs;
    }
  } catch {
    // getGPUFeatureStatus бросил (кривой драйвер) — контекст всё равно валиден
  }
  return ctx;
}

module.exports = { normalizeGpuInfo, buildGpuContext };
