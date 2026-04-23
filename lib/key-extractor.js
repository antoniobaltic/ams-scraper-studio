const { createContext, runInContext } = require('vm');

const AMS_FRONTEND_URL = 'https://jobs.ams.at/public/emps/';
const SECURITY_CHUNK_ID = '474';
const FETCH_TIMEOUT_MS = 10000;

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.text();
}

async function resolveChunkUrl() {
  const html = await fetchText(AMS_FRONTEND_URL);

  const runtimeFile = html.match(/runtime\.[a-f0-9]+\.js/);
  if (!runtimeFile) throw new Error('Could not find runtime bundle in AMS homepage');

  const runtimeJs = await fetchText(AMS_FRONTEND_URL + runtimeFile[0]);

  const hashMatch = runtimeJs.match(/\.u=\w+=>(\w+)\+"\.([a-f0-9]+)\.js"/);
  if (!hashMatch) throw new Error('Could not find chunk hash pattern in runtime bundle');

  return AMS_FRONTEND_URL + SECURITY_CHUNK_ID + '.' + hashMatch[2] + '.js';
}

function extractKeyFromChunk(code) {
  let capturedKey = null;

  class MockSubject {
    constructor(v) { this._v = v; }
    next(v) { this._v = v; }
    subscribe(fn) { if (typeof fn === 'function') fn(this._v); return { unsubscribe() {} }; }
    pipe() { return this; }
    getValue() { return this._v; }
    asObservable() { return this; }
  }

  const mockCrypto = {
    subtle: {
      importKey(_format, keyData, _algo, _extractable, _usages) {
        let bytes;
        if (keyData instanceof ArrayBuffer) {
          bytes = new Uint8Array(keyData);
        } else if (keyData && keyData.buffer instanceof ArrayBuffer) {
          bytes = new Uint8Array(keyData.buffer, keyData.byteOffset, keyData.byteLength);
        } else if (keyData && typeof keyData[Symbol.iterator] === 'function') {
          bytes = Uint8Array.from(keyData);
        }
        if (bytes) capturedKey = Array.from(bytes, b => String.fromCharCode(b)).join('');
        return Promise.resolve({ type: 'secret' });
      },
      sign() { return Promise.resolve(new ArrayBuffer(64)); },
    },
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
      return arr;
    },
  };

  function makeRequire() {
    return new Proxy(
      {
        KVO: x => x,
        WQX: t => { if (typeof t === 'function') { try { return new t(); } catch { return {}; } } return {}; },
        jDH: x => x, G2t: x => x, VBU: x => x, $C: x => x, MD: {},
        nKC: function (n) { this.name = n; },
        EmA: x => x,
        m: MockSubject,
      },
      { get(target, prop) { return prop in target ? target[prop] : function () { return new MockSubject(null); }; } },
    );
  }

  let capturedExports = null;
  const self = {
    webpackChunkjobsearch: {
      push(chunk) {
        const modules = chunk[1];
        for (const id in modules) {
          const exports = {};
          const req = function () { return makeRequire(); };
          req.r = exp => { Object.defineProperty(exp, '__esModule', { value: true }); };
          req.d = (exp, defs) => { for (const k in defs) Object.defineProperty(exp, k, { get: defs[k], enumerable: true, configurable: true }); };
          try { modules[id]({ exports }, exports, req); capturedExports = exports; } catch {}
        }
      },
    },
  };

  const ctx = createContext({
    self, console: { log() {}, error() {}, warn() {} },
    parseInt, parseFloat, String, Number, Math, Array, Object, Error, TypeError,
    RegExp, JSON, Date, Map, Set, Symbol, Promise,
    Uint8Array, Int32Array, Uint32Array, Uint16Array, Float64Array,
    ArrayBuffer, DataView, TextEncoder, TextDecoder,
    isNaN, encodeURIComponent, decodeURIComponent,
    crypto: mockCrypto, window: { crypto: mockCrypto },
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    setTimeout: fn => fn(), clearTimeout() {},
    Buffer,
  });

  runInContext(code, ctx, { timeout: 10000 });

  if (!capturedExports || !capturedExports.SecurityModule) {
    throw new Error('SecurityModule not found in chunk');
  }

  try { capturedExports.SecurityModule.createInterceptor(); } catch {}

  if (!capturedKey || capturedKey.length !== 64) {
    throw new Error('Could not extract HMAC key from SecurityModule');
  }

  return capturedKey;
}

async function extractKey() {
  const chunkUrl = await resolveChunkUrl();
  const chunkCode = await fetchText(chunkUrl);
  return extractKeyFromChunk(chunkCode);
}

module.exports = { extractKey, extractKeyFromChunk };
