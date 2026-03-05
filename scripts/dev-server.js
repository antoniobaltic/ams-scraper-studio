#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MAX_BODY_BYTES = 1024 * 1024;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const API_ROUTES = {
  '/api/health': require('../api/health'),
  '/api/location-suggest': require('../api/location-suggest'),
  '/api/scrape': require('../api/scrape'),
  '/api/stream': require('../api/stream'),
};

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function decorateResponse(res) {
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };

  res.json = function json(payload) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(payload));
    return res;
  };

  return res;
}

function safePublicPath(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const normalized = path.normalize(decoded);
  const candidate = normalized === '/' ? '/index.html' : normalized;
  const filePath = path.resolve(PUBLIC_DIR, `.${candidate}`);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    return null;
  }
  return filePath;
}

function serveStatic(urlPathname, res) {
  const filePath = safePublicPath(urlPathname);
  if (!filePath) {
    res.statusCode = 403;
    res.end('Forbidden');
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  const extension = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[extension] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

function notFound(res) {
  res.statusCode = 404;
  res.end('Not found');
}

async function handleApi(req, res, url) {
  const handler = API_ROUTES[url.pathname];
  if (!handler) {
    return notFound(res);
  }

  req.query = Object.fromEntries(url.searchParams.entries());

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    req.body = await readRequestBody(req);
  } else {
    req.body = {};
  }

  decorateResponse(res);

  try {
    await handler(req, res);
    if (!res.writableEnded && url.pathname !== '/api/stream') {
      res.end();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unhandled server error';
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: message }));
      return;
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  const didServe = serveStatic(url.pathname, res);
  if (!didServe) {
    notFound(res);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local dev server running at http://${HOST}:${PORT}`);
});
