'use strict';

const { BrowserWindow } = require('electron');

function createFetchScript(url) {
  return `
    fetch(${JSON.stringify(url)}, {
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*'
      }
    }).then(async (response) => {
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        text
      };
    });
  `;
}

async function fetchViaWindow(url) {
  const browserWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  let timeoutId = null;

  try {
    await new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timed out while opening Claude session')), 15000);
      browserWindow.webContents.once('did-finish-load', resolve);
      browserWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
        reject(new Error(`Failed to load Claude session: ${errorCode} ${errorDescription}`));
      });
      browserWindow.loadURL('https://claude.ai');
    });

    const response = await browserWindow.webContents.executeJavaScript(createFetchScript(url), true);
    const body = String(response?.text || '');

    if (!response?.ok) {
      if (response?.status === 401 || response?.status === 403) {
        throw new Error('Unauthorized');
      }

      throw new Error(`Claude API returned ${response?.status || 'unknown status'}`);
    }

    if (body.trim().startsWith('<')) {
      throw new Error('UnexpectedHTML');
    }

    return JSON.parse(body);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (!browserWindow.isDestroyed()) {
      browserWindow.destroy();
    }
  }
}

module.exports = {
  fetchViaWindow
};
