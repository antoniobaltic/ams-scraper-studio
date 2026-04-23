#!/usr/bin/env node
'use strict';

const { extractKey } = require('../lib/key-extractor');
const { createHmac, randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');

const SEARCH_API_PATH = '/public/emps/api/search';

async function verifyKey(key) {
  const paramPairs = [['page', '1'], ['pageSize', '1'], ['query', 'a'], ['sortField', '_SCORE']];
  const sorted = [...paramPairs].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const rawString = sorted.map(([k, v]) => `${k}=${v}`).join('&');
  const encodedString = sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const random = randomBytes(8).toString('hex');
  const message = `GET${SEARCH_API_PATH}${rawString}X-AMS-ACCESS-TOKEN-RANDOM=${random}`;
  const token = createHmac('sha512', key).update(message, 'utf8').digest('hex');

  const url = `https://jobs.ams.at${SEARCH_API_PATH}?${encodedString}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://jobs.ams.at/public/emps/jobs',
      'x-ams-access-token': token,
      'x-ams-access-token-random': random,
    },
  });

  return { status: response.status, ok: response.ok };
}

async function main() {
  console.log('Extracting current HMAC key from AMS frontend...\n');

  const key = await extractKey();
  console.log(`Key: ${key}`);

  console.log('\nVerifying key with test API call...');
  const result = await verifyKey(key);
  if (result.ok) {
    console.log(`Verified: API returned ${result.status}\n`);
  } else {
    console.error(`FAILED: API returned ${result.status}`);
    process.exit(1);
  }

  const amsPath = path.join(__dirname, '..', 'lib', 'ams.js');
  const amsCode = fs.readFileSync(amsPath, 'utf8');
  const currentMatch = amsCode.match(/let hmacKey = '([a-z0-9]+)'/);
  if (currentMatch && currentMatch[1] === key) {
    console.log('Hardcoded default is already up to date.');
  } else if (currentMatch) {
    console.log(`Hardcoded default is outdated: ${currentMatch[1]}`);
    if (process.argv.includes('--write')) {
      const updated = amsCode.replace(currentMatch[0], `let hmacKey = '${key}'`);
      fs.writeFileSync(amsPath, updated);
      console.log('Updated lib/ams.js with the new key.');
    } else {
      console.log('Run with --write to update lib/ams.js automatically.');
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
