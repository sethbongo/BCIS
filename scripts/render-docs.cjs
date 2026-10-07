// Electron helper for build-docs.mjs: loads each prepared HTML page and prints it to PDF.
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');

const jobs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.disableHardwareAcceleration();

async function load(win, file) {
  // A load started right after the previous document can be aborted by Chromium; retry a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      await win.loadFile(file);
      return;
    } catch (err) {
      if (attempt >= 4) throw err;
      await sleep(500);
    }
  }
}

async function render(win, job) {
  await load(win, job.html);
  // Wait until diagrams are drawn and fonts are loaded.
  for (let i = 0; i < 300; i++) {
    if (await win.webContents.executeJavaScript('window.__ready === true')) break;
    await sleep(100);
  }
  const title = win.webContents.getTitle();
  if (title.startsWith('ERROR')) throw new Error(`${job.html}: ${title}`);

  const footer = '<div style="width:100%;font-size:7px;color:#64748b;text-align:center;font-family:sans-serif">BCIS Subscription Billing and Collection System &middot; page <span class="pageNumber"></span> of <span class="totalPages"></span></div>';
  const options = { printBackground: true, pageSize: job.pageSize ?? 'A4', landscape: job.landscape ?? false, margins: { top: 0.6, bottom: 0.6, left: 0.65, right: 0.65 }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer };
  writeFileSync(job.pdf, await win.webContents.printToPDF(options));
  console.log(`  ${job.pdf}`);
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    const win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true } });
    for (const job of jobs) await render(win, job);
  } catch (err) {
    console.error(err);
    code = 1;
  }
  app.exit(code);
});
