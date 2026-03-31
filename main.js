'use strict';

const path = require('path');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  Tray,
  nativeImage,
  safeStorage,
  session
} = require('electron');
const Store = require('electron-store');

const { fetchViaWindow } = require('./src/fetch-via-window');
const { normalizeUsagePayload } = require('./src/lib/usage-normalizer');
const { DEFAULT_WINDOW_RULES, getWindowStatus } = require('./src/lib/window-status');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const WINDOW_WIDTH = 392;
const WINDOW_HEIGHT = 336;

const store = new Store({
  defaults: {
    settings: {
      alwaysOnTop: true,
      refreshIntervalSeconds: 60,
      showClaudeUsage: true,
      windowRules: DEFAULT_WINDOW_RULES
    }
  }
});

let mainWindow = null;
let tray = null;
let quitting = false;

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect width="64" height="64" rx="14" fill="#0b1020"/>
      <rect x="10" y="12" width="44" height="16" rx="8" fill="#ff6b6b"/>
      <rect x="10" y="36" width="44" height="16" rx="8" fill="#30d0a5"/>
    </svg>
  `;

  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function getSessionKey() {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = store.get('sessionKeyEncrypted');
    if (encrypted) {
      try {
        return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      } catch (_error) {
        return null;
      }
    }
  }

  return store.get('sessionKey') || null;
}

function saveSessionKey(sessionKey) {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(sessionKey);
    store.set('sessionKeyEncrypted', encrypted.toString('base64'));
    store.delete('sessionKey');
    return;
  }

  store.set('sessionKey', sessionKey);
}

function clearStoredCredentials() {
  store.delete('sessionKey');
  store.delete('sessionKeyEncrypted');
  store.delete('organizationId');
}

async function clearClaudeSessionData() {
  const cookies = await session.defaultSession.cookies.get({ url: 'https://claude.ai' });
  for (const cookie of cookies) {
    await session.defaultSession.cookies.remove('https://claude.ai', cookie.name);
  }

  await session.defaultSession.clearStorageData({
    origin: 'https://claude.ai',
    storages: ['cookies', 'localstorage', 'sessionstorage', 'cachestorage']
  });
}

async function setSessionCookie(sessionKey) {
  await session.defaultSession.cookies.set({
    url: 'https://claude.ai',
    name: 'sessionKey',
    value: sessionKey,
    domain: '.claude.ai',
    path: '/',
    secure: true,
    httpOnly: true
  });
}

function getSettings() {
  const settings = store.get('settings');
  return {
    alwaysOnTop: settings.alwaysOnTop !== false,
    refreshIntervalSeconds: Number(settings.refreshIntervalSeconds) || 60,
    showClaudeUsage: settings.showClaudeUsage !== false,
    windowRules: Array.isArray(settings.windowRules) && settings.windowRules.length
      ? settings.windowRules
      : DEFAULT_WINDOW_RULES
  };
}

function getCredentials() {
  return {
    sessionKey: getSessionKey(),
    organizationId: store.get('organizationId') || null
  };
}

function createMainWindow() {
  const bounds = store.get('windowBounds');
  const settings = getSettings();

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_WIDTH,
    maxWidth: WINDOW_WIDTH,
    minHeight: WINDOW_HEIGHT,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: false,
    icon: createTrayIcon(),
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('move', () => {
    const currentBounds = mainWindow.getBounds();
    store.set('windowBounds', { x: currentBounds.x, y: currentBounds.y });
  });

  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(createTrayIcon().resize({ width: 16, height: 16 }));
  tray.setToolTip('Claude Time-Slot Widget');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Show Widget',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Refresh',
      click: () => {
        mainWindow?.webContents.send('refresh-requested');
      }
    },
    {
      label: 'Reconnect Claude',
      click: () => {
        mainWindow?.webContents.send('reconnect-requested');
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]));

  tray.on('click', () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }

    mainWindow.show();
    mainWindow.focus();
  });
}

async function fetchOrganizations(sessionKey) {
  await setSessionCookie(sessionKey);
  const organizations = await fetchViaWindow('https://claude.ai/api/organizations');
  if (!Array.isArray(organizations) || !organizations.length) {
    throw new Error('No organization found');
  }

  return organizations[0].uuid || organizations[0].id;
}

async function fetchUsageData() {
  const credentials = getCredentials();
  if (!credentials.sessionKey || !credentials.organizationId) {
    return {
      authState: 'missing'
    };
  }

  try {
    await setSessionCookie(credentials.sessionKey);
    const usage = await fetchViaWindow(`https://claude.ai/api/organizations/${credentials.organizationId}/usage`);
    return normalizeUsagePayload(usage);
  } catch (error) {
    if (error.message === 'Unauthorized' || error.message === 'UnexpectedHTML') {
      clearStoredCredentials();
      await clearClaudeSessionData();
      mainWindow?.webContents.send('session-expired');
      return {
        authState: 'expired'
      };
    }

    throw error;
  }
}

function registerIpc() {
  ipcMain.handle('get-settings', () => getSettings());
  ipcMain.handle('save-settings', (_event, nextSettings) => {
    const safeSettings = {
      alwaysOnTop: nextSettings.alwaysOnTop !== false,
      refreshIntervalSeconds: Math.max(15, Number(nextSettings.refreshIntervalSeconds) || 60),
      showClaudeUsage: nextSettings.showClaudeUsage !== false,
      windowRules: Array.isArray(nextSettings.windowRules) && nextSettings.windowRules.length
        ? nextSettings.windowRules
        : DEFAULT_WINDOW_RULES
    };

    store.set('settings', safeSettings);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(safeSettings.alwaysOnTop, 'floating');
    }

    return safeSettings;
  });

  ipcMain.handle('get-credentials', () => getCredentials());
  ipcMain.handle('save-credentials', async (_event, credentials) => {
    saveSessionKey(credentials.sessionKey);
    store.set('organizationId', credentials.organizationId);
    await setSessionCookie(credentials.sessionKey);
    return true;
  });
  ipcMain.handle('delete-credentials', async () => {
    clearStoredCredentials();
    await clearClaudeSessionData();
    return true;
  });
  ipcMain.handle('detect-session-key', async () => {
    try {
      await session.defaultSession.cookies.remove('https://claude.ai', 'sessionKey');
    } catch (_error) {
      // ignore stale cookies
    }

    return new Promise((resolve) => {
      const loginWindow = new BrowserWindow({
        width: 1100,
        height: 760,
        title: 'Log in to Claude',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      let resolved = false;
      const onChanged = (_event, cookie, _cause, removed) => {
        if (
          cookie.name === 'sessionKey' &&
          cookie.domain.includes('claude.ai') &&
          cookie.value &&
          !removed
        ) {
          resolved = true;
          session.defaultSession.cookies.removeListener('changed', onChanged);
          loginWindow.close();
          resolve({
            success: true,
            sessionKey: cookie.value
          });
        }
      };

      session.defaultSession.cookies.on('changed', onChanged);
      loginWindow.on('closed', () => {
        session.defaultSession.cookies.removeListener('changed', onChanged);
        if (!resolved) {
          resolve({
            success: false,
            error: 'Login window closed before a Claude session was detected.'
          });
        }
      });
      loginWindow.loadURL('https://claude.ai/login');
    });
  });
  ipcMain.handle('validate-session-key', async (_event, sessionKey) => {
    try {
      const organizationId = await fetchOrganizations(sessionKey);
      return {
        success: true,
        organizationId
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  });
  ipcMain.handle('fetch-usage-data', () => fetchUsageData());
  ipcMain.handle('get-window-status', () => {
    const settings = getSettings();
    return getWindowStatus({
      rules: settings.windowRules
    });
  });
  ipcMain.handle('minimize-window', () => {
    mainWindow?.hide();
    return true;
  });
  ipcMain.handle('close-window', () => {
    mainWindow?.hide();
    return true;
  });
  ipcMain.handle('get-window-position', () => {
    if (!mainWindow) {
      return null;
    }

    const bounds = mainWindow.getBounds();
    return { x: bounds.x, y: bounds.y };
  });
  ipcMain.handle('set-window-position', (_event, position) => {
    if (!mainWindow || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
      return false;
    }

    mainWindow.setPosition(position.x, position.y);
    return true;
  });
  ipcMain.handle('show-notification', (_event, payload) => {
    if (!Notification.isSupported()) {
      return false;
    }

    const notification = new Notification({
      title: payload.title,
      body: payload.body
    });
    notification.show();
    return true;
  });
}

app.whenReady().then(async () => {
  session.defaultSession.setUserAgent(USER_AGENT);

  const sessionKey = getSessionKey();
  if (sessionKey) {
    try {
      await setSessionCookie(sessionKey);
    } catch (_error) {
      clearStoredCredentials();
    }
  }

  registerIpc();
  createMainWindow();
  createTray();
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  // Keep the tray process alive on Windows.
});
