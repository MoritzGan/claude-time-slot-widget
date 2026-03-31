'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getCredentials: () => ipcRenderer.invoke('get-credentials'),
  saveCredentials: (credentials) => ipcRenderer.invoke('save-credentials', credentials),
  deleteCredentials: () => ipcRenderer.invoke('delete-credentials'),
  detectSessionKey: () => ipcRenderer.invoke('detect-session-key'),
  validateSessionKey: (sessionKey) => ipcRenderer.invoke('validate-session-key', sessionKey),
  fetchUsageData: () => ipcRenderer.invoke('fetch-usage-data'),
  getWindowStatus: () => ipcRenderer.invoke('get-window-status'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  setWindowPosition: (position) => ipcRenderer.invoke('set-window-position', position),
  showNotification: (payload) => ipcRenderer.invoke('show-notification', payload),
  onRefreshRequested: (callback) => ipcRenderer.on('refresh-requested', callback),
  onReconnectRequested: (callback) => ipcRenderer.on('reconnect-requested', callback),
  onSessionExpired: (callback) => ipcRenderer.on('session-expired', callback)
});
