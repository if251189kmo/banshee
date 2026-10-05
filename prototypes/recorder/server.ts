// `npm run recorder` — записувач кроку 0.2 (.claude/logic/13-plan.md). Інструмент розробки,
// у продукт не потрапляє. Сторінка в браузері пише WAV 16 кГц у `.data/recordings`.
//
// Чому сервер, а не файл зі сторінкою: Chrome не завантажує модулі й AudioWorklet зі сторінки,
// відкритої з диска. Сервер слухає лише 127.0.0.1; запис приймає з одноразовим токеном, лише зі
// своєї сторінки й лише в теку записів.
//   npm run recorder                      — запустити й відкрити сторінку;
//   npm run recorder -- --no-open         — лише запустити;
//   npm run recorder -- --dir <тека>      — інша тека записів.
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseDataset } from '../../scripts/lib/evals/dataset.ts';
import { buildPlan } from './sets.ts';
import { loadManifest, parseMeta, saveRecording } from './storage.ts';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 47821;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC = new URL('./public/', import.meta.url);
const DATASET = new URL('../../evals/commands.json', import.meta.url);

const STATIC: Readonly<Record<string, string>> = {
  'index.html': 'text/html; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'audio.js': 'text/javascript; charset=utf-8',
  'wav.js': 'text/javascript; charset=utf-8',
  'capture-worklet.js': 'text/javascript; charset=utf-8',
};

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'",
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
};

function send(response: ServerResponse, status: number, body: string, type: string): void {
  response.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > MAX_BODY_BYTES) throw new Error('Запис завеликий');
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

function sameToken(given: string | string[] | undefined, token: string): boolean {
  if (typeof given !== 'string' || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

function openBrowser(url: string): void {
  execFile('explorer.exe', [url], () => {
    // explorer.exe повертає код 1 навіть після успіху — результат не перевіряємо.
  });
}

function main(): void {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
    },
  });
  const root = resolve(REPO, values.dir ?? '.data/recordings');
  const port = values.port ? Number(values.port) : DEFAULT_PORT;
  const token = randomBytes(16).toString('hex');
  const origin = `http://${HOST}:${String(port)}`;

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', origin);
        // Захист від DNS rebinding: лише запити, адресовані саме цьому серверу.
        if (request.headers.host !== `${HOST}:${String(port)}`) {
          send(response, 403, 'Forbidden', 'text/plain; charset=utf-8');
          return;
        }
        if (request.method === 'GET' && url.pathname === '/favicon.ico') {
          response.writeHead(204, SECURITY_HEADERS);
          response.end();
          return;
        }
        if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
          const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          const type = STATIC[name];
          if (!type) {
            send(response, 404, 'Not found', 'text/plain; charset=utf-8');
            return;
          }
          send(response, 200, await readFile(new URL(name, PUBLIC), 'utf8'), type);
          return;
        }
        if (!sameToken(request.headers['x-recorder-token'], token)) {
          sendJson(response, 401, {
            error: 'Немає токена: відкрий адресу, яку надрукував записувач',
          });
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/state') {
          const dataset = parseDataset(JSON.parse(await readFile(DATASET, 'utf8')) as unknown);
          sendJson(response, 200, { plan: buildPlan(dataset), manifest: await loadManifest(root) });
          return;
        }
        const match = /^\/api\/recordings\/([a-z]+)\/([^/]+)$/.exec(url.pathname);
        if (request.method === 'PUT' && match && request.headers.origin === origin) {
          const [, set = '', file = ''] = match;
          const meta = parseMeta(request.headers['x-recorder-meta'] as string | undefined);
          const manifest = await saveRecording(root, set, file, await readBody(request), meta);
          sendJson(response, 200, { manifest });
          return;
        }
        sendJson(response, 404, { error: 'Невідомий запит' });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  server.listen(port, HOST, () => {
    const address = `${origin}/?token=${token}`;
    console.log(`Записувач кроку 0.2: ${address}`);
    console.log(`Записи: ${root}`);
    console.log('Зупинити — Ctrl+C.');
    if (values['no-open'] !== true) openBrowser(address);
  });
}

main();
