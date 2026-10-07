import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';

/**
 * Nothing but the box itself: its scripts, its stylesheet (constructed in the page, so no inline
 * style), and its own API. The tab icon is a data URL.
 */
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smia · Klipp</title>
<link rel="icon" href="data:,">
<script type="module" src="/ui/box/ui/app.js"></script>
</head>
<body></body>
</html>
`;

/** The page's scripts: the UI's own modules and the DOM helper they share with Klipp's UI. */
const ASSET = /^\/ui\/((?:box\/ui\/[a-z-]+|client\/ui\/dom)\.js)$/;

function headers(res: ServerResponse, type: string) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

export function servePage(res: ServerResponse) {
  headers(res, 'text/html; charset=utf-8');
  res.end(PAGE);
}

/** Serves one of the UI's scripts from the built package; false when the path isn't one. */
export function serveAsset(res: ServerResponse, path: string, assets: string): boolean {
  const font = path === '/ui/box/ui/assets/nunito.woff2';
  const file = font ? 'box/ui/assets/nunito.woff2' : ASSET.exec(path)?.[1];
  if (!file) return false;
  readFile(join(assets, file)).then(
    (body) => {
      headers(res, font ? 'font/woff2' : 'text/javascript; charset=utf-8');
      res.end(body);
    },
    () => {
      res.statusCode = 404;
      res.end();
    },
  );
  return true;
}

/** Static refusal: no authenticated scripts needed to explain how to regain access. */
export function serveRefusal(res: ServerResponse, status: number, message: string) {
  headers(res, 'text/html; charset=utf-8');
  res.statusCode = status;
  // Messages are fixed server strings, never header values or other user input.
  res.end(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Smia · Access required</title><body><main><h1>Smia</h1><h2>${status === 401 ? 'Sign-in required' : 'Access denied'}</h2><p>${message}</p></main></body></html>`,
  );
}
