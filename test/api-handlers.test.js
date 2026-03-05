const test = require('node:test');
const assert = require('node:assert/strict');

const scrapeHandler = require('../api/scrape');
const streamHandler = require('../api/stream');
const healthHandler = require('../api/health');
const locationSuggestHandler = require('../api/location-suggest');

function createJsonRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function createSseRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    writes: [],
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    flushHeaders() {},
    write(chunk) {
      this.writes.push(chunk);
    },
    end() {
      this.ended = true;
    },
    json(payload) {
      this.payload = payload;
      this.ended = true;
      return this;
    },
  };
}

function parseSseEvents(writes) {
  return writes
    .map((chunk) => String(chunk).trim())
    .filter(Boolean)
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

test('scrape returns 400 for invalid JSON bodies', async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  const req = { method: 'POST', body: '{bad json' };
  const res = createJsonRes();
  await scrapeHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /Invalid JSON body/i);
});

test('stream returns 400 for invalid JSON bodies', async (t) => {
  const previousFetch = global.fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  const req = { method: 'POST', body: '{bad json' };
  const res = createSseRes();
  await streamHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /Invalid JSON body/i);
});

test('stream does not retry non-retryable AMS 400 responses', async (t) => {
  const previousFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return {
      ok: false,
      status: 400,
      json: async () => ({ code: 'VALIDATION', message: 'Bad request' }),
    };
  };
  t.after(() => {
    global.fetch = previousFetch;
  });

  const req = {
    method: 'POST',
    body: {
      query: 'software',
      location: 'Wien',
      radius: '20',
      maxPages: 3,
      maxJobs: 100,
      filters: [],
    },
  };
  const res = createSseRes();
  await streamHandler(req, res);

  assert.equal(callCount, 1);
  const events = parseSseEvents(res.writes);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].page, 1);
  assert.equal(events[1].type, 'done');
});

test('scrape omits vicinity when no locationId exists', async (t) => {
  const previousFetch = global.fetch;
  let calledUrl = '';
  global.fetch = async (url) => {
    calledUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        totalResults: 1,
        totalPages: 1,
        page: 1,
        pageSize: 30,
        results: [],
      }),
    };
  };
  t.after(() => {
    global.fetch = previousFetch;
  });

  const req = {
    method: 'POST',
    body: {
      query: 'software',
      location: 'Wien',
      radius: '20',
      locationId: '',
      filters: [],
    },
  };
  const res = createJsonRes();
  await scrapeHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(calledUrl, /location=Wien/);
  assert.doesNotMatch(calledUrl, /vicinity=/);
});

test('health returns ok when AMS response shape is valid', async (t) => {
  const previousFetch = global.fetch;
  let calledUrl = '';
  global.fetch = async (url) => {
    calledUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        totalResults: 42,
        totalPages: 1,
        page: 1,
        pageSize: 1,
        results: [],
      }),
    };
  };
  t.after(() => {
    global.fetch = previousFetch;
  });

  const req = { method: 'GET' };
  const res = createJsonRes();
  await healthHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'ok');
  assert.equal(res.payload.totalResults, 42);
  assert.match(calledUrl, /public\/emps\/api\/search/);
  assert.match(calledUrl, /query=a/);
});

test('location-suggest rejects non-GET requests', async () => {
  const req = { method: 'POST', query: { text: 'Wien' } };
  const res = createJsonRes();
  await locationSuggestHandler(req, res);
  assert.equal(res.statusCode, 405);
});
