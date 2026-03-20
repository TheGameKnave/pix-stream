import { CommonEngine } from '@angular/ssr/node';
import express from 'express';
import compression from 'compression';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bootstrap from './src/main.server';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

const app = express();
app.disable('x-powered-by');

app.use(compression());

const commonEngine = new CommonEngine();

app.get('/ngsw.json', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(join(browserDistFolder, 'ngsw.json'));
});

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
  })
);

app.get('*', (req, res) => {
  const { protocol, originalUrl, headers } = req;

  commonEngine
    .render({
      bootstrap,
      documentFilePath: indexHtml,
      url: `${protocol}://${headers.host}${originalUrl}`,
      publicPath: browserDistFolder,
    })
    .then((html) => res.send(html))
    .catch((err) => {
      console.error('SSR Error:', err.message);
      res.sendFile(join(browserDistFolder, 'index.csr.html'));
    });
});

const port = process.env['PORT'] || 4000;
app.listen(port, () => {
  console.log(`SSR server listening on http://localhost:${port}`);
});

export { app };
