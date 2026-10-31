// Real Chrome on Linux or Windows Chrome through WSL. Use an isolated test profile.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { mkdtemp, copyFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
const profiles = new WeakMap();
const candidates = [
  '/tmp/cft/x/chrome-headless-shell-linux64/chrome-headless-shell',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
];
const translate = (flag,path) => execFileSync('wslpath',[flag,path],{encoding:'utf8'}).trim();
const cleanup = root => rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});

export async function launchAcceptanceBrowser() {
  const executablePath = process.env.CHROME_BIN || candidates.find(existsSync);
  if (!executablePath) throw Error('Chrome was not found. Set CHROME_BIN to its executable.');
  let root;
  try {
    const options = {executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
    if (executablePath.endsWith('.exe') && process.platform === 'linux') {
      const temp = execFileSync('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
        ['-NoProfile','-NonInteractive','-Command','[Console]::WriteLine($env:TEMP)'],{encoding:'utf8'}).trim();
      root = await mkdtemp(join(translate('-u',temp),'mendcue-browser-'));
      options.userDataDir = translate('-w',join(root,'profile'));
    }
    const browser = await puppeteer.launch(options);
    if (root) {
      profiles.set(browser,root);
      const close = browser.close.bind(browser);
      browser.close = async () => { try { await close(); } finally { await cleanup(root); } };
    }
    return browser;
  } catch (error) { if (root) await cleanup(root); throw error; }
}

export async function browserUploadPath(browser,path) {
  const root = profiles.get(browser);
  if (!root) return path;
  const dir = join(root,'uploads'); await mkdir(dir,{recursive:true});
  const target = join(dir,basename(path)); await copyFile(path,target);
  return translate('-w',target);
}

export async function browserDownloadDirectory(browser,localPath) {
  const root = profiles.get(browser);
  if (!root) return {localPath,browserPath:localPath};
  const path = join(root,'downloads'); await mkdir(path,{recursive:true});
  return {localPath:path,browserPath:translate('-w',path)};
}
