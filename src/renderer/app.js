'use strict';

const elements = {
  statusBadge: document.getElementById('statusBadge'),
  nextChangeLabel: document.getElementById('nextChangeLabel'),
  windowDescription: document.getElementById('windowDescription'),
  localWindowDescription: document.getElementById('localWindowDescription'),
  localTimeValue: document.getElementById('localTimeValue'),
  sourceZoneValue: document.getElementById('sourceZoneValue'),
  authStateTitle: document.getElementById('authStateTitle'),
  connectButton: document.getElementById('connectButton'),
  usageRows: document.getElementById('usageRows'),
  usageMessage: document.getElementById('usageMessage'),
  fiveHourUsage: document.getElementById('fiveHourUsage'),
  fiveHourReset: document.getElementById('fiveHourReset'),
  weeklyUsage: document.getElementById('weeklyUsage'),
  refreshButton: document.getElementById('refreshButton'),
  settingsButton: document.getElementById('settingsButton'),
  minimizeButton: document.getElementById('minimizeButton'),
  closeButton: document.getElementById('closeButton'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  closeSettingsButton: document.getElementById('closeSettingsButton'),
  alwaysOnTopInput: document.getElementById('alwaysOnTopInput'),
  showClaudeUsageInput: document.getElementById('showClaudeUsageInput'),
  refreshIntervalInput: document.getElementById('refreshIntervalInput'),
  timezoneInput: document.getElementById('timezoneInput'),
  startTimeInput: document.getElementById('startTimeInput'),
  endTimeInput: document.getElementById('endTimeInput'),
  weekdayInputs: Array.from(document.querySelectorAll('[data-day]')),
  saveSettingsButton: document.getElementById('saveSettingsButton'),
  disconnectButton: document.getElementById('disconnectButton')
};

const state = {
  settings: null,
  windowStatus: null,
  usageData: null,
  statusTimer: null,
  usageTimer: null
};

function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return '--';
  }

  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatResetCountdown(isoTime) {
  if (!isoTime) {
    return '--';
  }

  return formatDuration(new Date(isoTime).getTime() - Date.now());
}

function updateLocalClock() {
  const now = new Date();
  elements.localTimeValue.textContent = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  if (!state.windowStatus?.nextChangeAt) {
    elements.nextChangeLabel.textContent = 'Next change unavailable';
    return;
  }

  const remaining = new Date(state.windowStatus.nextChangeAt).getTime() - Date.now();
  elements.nextChangeLabel.textContent = `Next change in ${formatDuration(remaining)}`;

  if (remaining <= 0) {
    refreshWindowStatus();
  }

  if (state.usageData?.fiveHour?.resetsAt) {
    elements.fiveHourReset.textContent = formatResetCountdown(state.usageData.fiveHour.resetsAt);
  }
}

function renderWindowStatus(status) {
  state.windowStatus = status;
  elements.statusBadge.textContent = status.state;
  elements.statusBadge.classList.toggle('peak', status.isPeak);
  elements.windowDescription.textContent = `Peak window: ${status.canonicalRange}`;
  elements.localWindowDescription.textContent = `Local equivalent: ${status.localDisplayRange}`;
  elements.sourceZoneValue.textContent = status.canonicalTimezone;
  updateLocalClock();
}

function renderUsage(data) {
  state.usageData = data;

  if (!state.settings.showClaudeUsage) {
    elements.usageRows.classList.add('hidden');
    elements.usageMessage.textContent = 'Claude live data is disabled in settings.';
    elements.authStateTitle.textContent = 'Usage Hidden';
    elements.connectButton.textContent = 'Log In';
    return;
  }

  if (data?.authState !== 'connected' || !data.fiveHour || !data.sevenDay) {
    elements.usageRows.classList.add('hidden');
    elements.authStateTitle.textContent = 'Reconnect Claude';
    elements.connectButton.textContent = 'Log In';
    elements.usageMessage.textContent = 'Claude is not connected. The widget still tracks peak and off-peak hours.';
    return;
  }

  elements.usageRows.classList.remove('hidden');
  elements.authStateTitle.textContent = 'Claude Connected';
  elements.connectButton.textContent = 'Refresh Login';
  elements.usageMessage.textContent = `Updated ${new Date(data.fetchedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
  elements.fiveHourUsage.textContent = `${Math.round(data.fiveHour.utilization)}%`;
  elements.fiveHourReset.textContent = formatResetCountdown(data.fiveHour.resetsAt);
  elements.weeklyUsage.textContent = `${Math.round(data.sevenDay.utilization)}%`;
}

async function refreshWindowStatus() {
  const status = await window.electronAPI.getWindowStatus();
  renderWindowStatus(status);
}

async function refreshUsageData() {
  if (!state.settings.showClaudeUsage) {
    renderUsage({ authState: 'hidden' });
    return;
  }

  const usage = await window.electronAPI.fetchUsageData();
  renderUsage(usage);
}

function getSettingsPayload() {
  return {
    alwaysOnTop: elements.alwaysOnTopInput.checked,
    showClaudeUsage: elements.showClaudeUsageInput.checked,
    refreshIntervalSeconds: Number(elements.refreshIntervalInput.value) || 60,
    windowRules: [
      {
        id: 'peak-hours-default',
        label: 'Peak',
        color: '#ff6b6b',
        timezone: elements.timezoneInput.value.trim() || 'America/Los_Angeles',
        startTime: elements.startTimeInput.value || '05:00',
        endTime: elements.endTimeInput.value || '11:00',
        weekdays: elements.weekdayInputs
          .filter((input) => input.checked)
          .map((input) => Number(input.dataset.day)),
        enabled: true,
        priority: 1
      }
    ]
  };
}

function populateSettingsForm(settings) {
  const rule = settings.windowRules[0];
  elements.alwaysOnTopInput.checked = settings.alwaysOnTop;
  elements.showClaudeUsageInput.checked = settings.showClaudeUsage;
  elements.refreshIntervalInput.value = String(settings.refreshIntervalSeconds);
  elements.timezoneInput.value = rule.timezone;
  elements.startTimeInput.value = rule.startTime;
  elements.endTimeInput.value = rule.endTime;

  for (const input of elements.weekdayInputs) {
    input.checked = rule.weekdays.includes(Number(input.dataset.day));
  }
}

function restartUsagePolling() {
  if (state.usageTimer) {
    clearInterval(state.usageTimer);
  }

  state.usageTimer = setInterval(() => {
    refreshUsageData().catch(console.error);
  }, state.settings.refreshIntervalSeconds * 1000);
}

function bindEvents() {
  elements.refreshButton.addEventListener('click', async () => {
    await Promise.all([refreshWindowStatus(), refreshUsageData()]);
  });

  elements.settingsButton.addEventListener('click', () => {
    populateSettingsForm(state.settings);
    elements.settingsOverlay.classList.remove('hidden');
  });

  elements.closeSettingsButton.addEventListener('click', () => {
    elements.settingsOverlay.classList.add('hidden');
  });

  elements.saveSettingsButton.addEventListener('click', async () => {
    const payload = getSettingsPayload();
    state.settings = await window.electronAPI.saveSettings(payload);
    elements.settingsOverlay.classList.add('hidden');
    await refreshWindowStatus();
    await refreshUsageData();
    restartUsagePolling();
  });

  elements.connectButton.addEventListener('click', async () => {
    elements.connectButton.disabled = true;
    elements.connectButton.textContent = 'Waiting...';

    try {
      const detected = await window.electronAPI.detectSessionKey();
      if (!detected.success) {
        elements.usageMessage.textContent = detected.error || 'Claude login was not completed.';
        return;
      }

      const validation = await window.electronAPI.validateSessionKey(detected.sessionKey);
      if (!validation.success) {
        elements.usageMessage.textContent = validation.error || 'Claude session validation failed.';
        return;
      }

      await window.electronAPI.saveCredentials({
        sessionKey: detected.sessionKey,
        organizationId: validation.organizationId
      });
      await refreshUsageData();
    } finally {
      elements.connectButton.disabled = false;
      if (state.usageData?.authState === 'connected') {
        elements.connectButton.textContent = 'Refresh Login';
      } else {
        elements.connectButton.textContent = 'Log In';
      }
    }
  });

  elements.disconnectButton.addEventListener('click', async () => {
    await window.electronAPI.deleteCredentials();
    renderUsage({ authState: 'missing' });
    elements.settingsOverlay.classList.add('hidden');
  });

  elements.minimizeButton.addEventListener('click', () => {
    window.electronAPI.minimizeWindow();
  });

  elements.closeButton.addEventListener('click', () => {
    window.electronAPI.closeWindow();
  });

  window.electronAPI.onRefreshRequested(() => {
    refreshUsageData().catch(console.error);
    refreshWindowStatus().catch(console.error);
  });

  window.electronAPI.onReconnectRequested(() => {
    elements.connectButton.click();
  });

  window.electronAPI.onSessionExpired(() => {
    renderUsage({ authState: 'expired' });
  });
}

async function init() {
  state.settings = await window.electronAPI.getSettings();
  bindEvents();
  await refreshWindowStatus();
  await refreshUsageData();
  restartUsagePolling();

  state.statusTimer = setInterval(() => {
    updateLocalClock();
  }, 1000);
}

init().catch((error) => {
  console.error(error);
  elements.usageMessage.textContent = error.message;
});

window.addEventListener('beforeunload', () => {
  if (state.statusTimer) {
    clearInterval(state.statusTimer);
  }

  if (state.usageTimer) {
    clearInterval(state.usageTimer);
  }
});
