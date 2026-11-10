'use strict';

/**
 * FastStream Desktop UI Controller
 * 100% Brand-new, self-contained, high-performance UI implementation
 */

const tasks = new Map();
let currentFilter = 'all';
let currentCategory = null;
let defaultDownloadDir = '';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// Utility: Format bytes
function fmtBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i >= 2 ? 2 : 1) + ' ' + units[i];
}

// Utility: Format speed
function fmtSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  return fmtBytes(bytesPerSec) + '/s';
}

// Utility: Format ETA
function fmtEta(seconds) {
  if (!seconds || !isFinite(seconds) || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Extract filename from URL
function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const n = decodeURIComponent(u.pathname.split('/').pop() || '');
    return n.split('?')[0] || 'download.bin';
  } catch (e) {
    return 'download.bin';
  }
}

// Detect category from filename
function guessCategory(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['mp4', 'mkv', 'avi', 'mov', 'flv', 'webm', 'ts', 'm4v'].includes(ext)) return '视频';
  if (['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg'].includes(ext)) return '音乐';
  if (['exe', 'msi', 'dmg', 'apk', 'deb', 'rpm'].includes(ext)) return '程序';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'xz'].includes(ext)) return '压缩包';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'].includes(ext)) return '文档';
  return '常规';
}

// Render Task List
function renderTaskList() {
  const container = $('#taskList');
  const empty = $('#emptyState');

  const filtered = Array.from(tasks.values()).filter((t) => {
    if (currentFilter === 'downloading') return ['connecting', 'downloading', 'merging'].includes(t.status);
    if (currentFilter === 'completed') return t.status === 'done';
    if (currentFilter === 'paused') return t.status === 'paused';
    if (currentCategory) return t.category === currentCategory;
    return true;
  });

  // Update badges
  $('#badgeAll').textContent = tasks.size;
  $('#badgeDownloading').textContent = Array.from(tasks.values()).filter(t => ['downloading', 'connecting'].includes(t.status)).length;
  $('#badgeDone').textContent = Array.from(tasks.values()).filter(t => t.status === 'done').length;
  $('#badgePaused').textContent = Array.from(tasks.values()).filter(t => t.status === 'paused').length;

  // Calculate total aggregate speed
  const totalSpeed = Array.from(tasks.values())
    .filter(t => t.status === 'downloading')
    .reduce((acc, t) => acc + (t.speed || 0), 0);
  $('#totalSpeedVal').textContent = fmtSpeed(totalSpeed);

  if (filtered.length === 0) {
    empty.style.display = 'flex';
    // Remove existing cards
    const cards = container.querySelectorAll('.task-card');
    cards.forEach(c => c.remove());
    return;
  }

  empty.style.display = 'none';

  // Build / update cards
  filtered.forEach((task) => {
    let card = container.querySelector(`[data-task-id="${task.id}"]`);
    const pct = task.size ? Math.min(100, Math.round((task.downloaded / task.size) * 100)) : 0;

    if (!card) {
      card = document.createElement('div');
      card.className = 'task-card';
      card.setAttribute('data-task-id', task.id);
      container.appendChild(card);
    }

    const isRunning = ['downloading', 'connecting', 'merging'].includes(task.status);
    const isDone = task.status === 'done';

    // Segments visualizer blocks
    const segs = task.segments || [];
    const segBlocksHtml = segs.map(s => {
      const segDone = s.done;
      const segPct = s.end ? Math.min(100, Math.round(((s.cur - s.start) / (s.end - s.start + 1)) * 100)) : (segDone ? 100 : 0);
      return `<div class="segment-block"><div class="segment-fill ${segDone ? 'done' : ''}" style="width: ${segPct}%"></div></div>`;
    }).join('');

    card.innerHTML = `
      <div class="task-row">
        <input type="checkbox" class="col-check task-check" data-id="${task.id}">
        <div class="col col-name">
          <div class="task-filename" title="${task.filename}">${task.filename}</div>
          <div class="task-url" title="${task.url}">${task.url}</div>
        </div>
        <div class="col col-size">${fmtBytes(task.downloaded)} / ${fmtBytes(task.size)}</div>
        <div class="col col-status">
          <span class="status-pill status-${task.status}">${task.status.toUpperCase()}</span>
        </div>
        <div class="col col-progress">
          <div class="prog-bar-wrap">
            <div class="prog-bar-fill" style="width: ${pct}%"></div>
          </div>
          <div class="segments-track">${segBlocksHtml}</div>
        </div>
        <div class="col col-speed">${isRunning ? fmtSpeed(task.speed) : '—'}</div>
        <div class="col col-eta">${isRunning ? fmtEta(task.eta) : '—'}</div>
        <div class="col col-actions">
          ${!isDone ? `
            <button class="btn btn-secondary btn-icon btn-action-toggle" data-id="${task.id}" title="${isRunning ? 'Pause' : 'Resume'}">
              ${isRunning ? '⏸️' : '▶️'}
            </button>
          ` : `
            <button class="btn btn-secondary btn-icon btn-action-open" data-id="${task.id}" title="Open File">
              📂
            </button>
          `}
          <button class="btn btn-secondary btn-icon btn-action-delete" data-id="${task.id}" title="Delete">
            🗑️
          </button>
        </div>
      </div>
    `;

    // Bind action events
    const btnToggle = card.querySelector('.btn-action-toggle');
    if (btnToggle) {
      btnToggle.onclick = () => {
        if (isRunning) window.faststreamAPI.pause(task.id);
        else window.faststreamAPI.resume(task.id);
      };
    }

    const btnOpen = card.querySelector('.btn-action-open');
    if (btnOpen) {
      btnOpen.onclick = () => {
        window.faststreamAPI.openFile(task.dir + '/' + task.filename);
      };
    }

    const btnDel = card.querySelector('.btn-action-delete');
    if (btnDel) {
      btnDel.onclick = () => {
        if (confirm(`Remove task "${task.filename}"?`)) {
          window.faststreamAPI.remove(task.id, false);
          tasks.delete(task.id);
          card.remove();
          renderTaskList();
        }
      };
    }
  });
}

// Modal handling
function showModal(id) { $(id).classList.add('show'); }
function hideModal(id) { $(id).classList.remove('show'); }

// Open New Download Modal with Prefill
function openNewDownload(prefill = {}) {
  const url = prefill.url || '';
  $('#inputUrl').value = url;
  const name = prefill.filename || (url ? nameFromUrl(url) : '');
  $('#inputFilename').value = name;
  $('#selectCategory').value = guessCategory(name);
  $('#inputDir').value = prefill.dir || defaultDownloadDir;
  $('#inputConnections').value = 8;
  $('#connLabel').textContent = '8';
  $('#inputRateLimit').value = 0;
  $('#rateLabel').textContent = 'Unlimited';
  showModal('#modalNewDownload');
}

// Initialize Application
async function init() {
  console.log('[FastStream UI] Initializing interface...');

  // 1. Bind UI Toolbar Events IMMEDIATELY (never block on IPC)
  const handleOpenNew = async () => {
    let clipboardText = '';
    try {
      if (window.faststreamAPI && window.faststreamAPI.clipboardRead) {
        clipboardText = await window.faststreamAPI.clipboardRead();
      }
    } catch (e) {
      console.warn('[FastStream UI] Clipboard read skipped:', e);
    }
    if (clipboardText && (clipboardText.startsWith('http://') || clipboardText.startsWith('https://'))) {
      openNewDownload({ url: clipboardText.trim() });
    } else {
      openNewDownload();
    }
  };

  const btnOpenNew = $('#btnOpenNew');
  if (btnOpenNew) btnOpenNew.onclick = handleOpenNew;

  const btnEmptyNew = $('#btnEmptyNew');
  if (btnEmptyNew) btnEmptyNew.onclick = handleOpenNew;

  $('#btnResumeAll').onclick = () => {
    if (!window.faststreamAPI) return;
    tasks.forEach(t => {
      if (['paused', 'error'].includes(t.status)) window.faststreamAPI.resume(t.id);
    });
  };

  $('#btnPauseAll').onclick = () => {
    if (!window.faststreamAPI) return;
    tasks.forEach(t => {
      if (['downloading', 'connecting'].includes(t.status)) window.faststreamAPI.pause(t.id);
    });
  };

  $('#btnOpenSettings').onclick = () => showModal('#modalSettings');
  $('#btnCloseSettingsModal').onclick = () => hideModal('#modalSettings');
  $('#btnCloseNewModal').onclick = () => hideModal('#modalNewDownload');
  $('#btnCancelDownload').onclick = () => hideModal('#modalNewDownload');

  // Input changes
  $('#inputUrl').addEventListener('input', () => {
    const url = $('#inputUrl').value.trim();
    if (url && !$('#inputFilename').value) {
      const detected = nameFromUrl(url);
      $('#inputFilename').value = detected;
      $('#selectCategory').value = guessCategory(detected);
    }
  });

  $('#inputConnections').addEventListener('input', (e) => {
    $('#connLabel').textContent = e.target.value;
  });

  $('#inputRateLimit').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    $('#rateLabel').textContent = val > 0 ? `${fmtBytes(val * 1024)}/s` : 'Unlimited';
  });

  $('#btnBrowseDir').onclick = async () => {
    if (!window.faststreamAPI) return;
    const chosen = await window.faststreamAPI.chooseDir();
    if (chosen) $('#inputDir').value = chosen;
  };

  $('#btnSettingBrowseDir').onclick = async () => {
    if (!window.faststreamAPI) return;
    const chosen = await window.faststreamAPI.chooseDir();
    if (chosen) $('#settingDefaultDir').value = chosen;
  };

  // Submit New Download
  $('#btnSubmitDownload').onclick = async () => {
    const url = $('#inputUrl').value.trim();
    if (!url) return;

    const filename = $('#inputFilename').value.trim() || nameFromUrl(url);
    const dir = $('#inputDir').value.trim() || defaultDownloadDir;
    const connections = parseInt($('#inputConnections').value) || 8;
    const maxRate = parseInt($('#inputRateLimit').value) || 0;

    if (window.faststreamAPI) {
      await window.faststreamAPI.add({
        url,
        filename,
        dir,
        connections,
        maxRate,
      });
    }

    hideModal('#modalNewDownload');
  };

  // Save Settings
  $('#btnSaveSettings').onclick = async () => {
    const updated = {
      defaultDir: $('#settingDefaultDir').value,
      maxConcurrent: parseInt($('#settingMaxConcurrent').value) || 3,
      defaultConnections: parseInt($('#settingDefaultConn').value) || 8,
    };
    if (window.faststreamAPI) {
      await window.faststreamAPI.saveSettings(updated);
    }
    defaultDownloadDir = updated.defaultDir;
    hideModal('#modalSettings');
  };

  // Navigation Filter click handlers
  $$('.nav-item').forEach(item => {
    item.onclick = () => {
      $$('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const filter = item.getAttribute('data-filter');
      const cat = item.getAttribute('data-category');

      if (filter) {
        currentFilter = filter;
        currentCategory = null;
      } else if (cat) {
        currentFilter = 'all';
        currentCategory = item.querySelector('.nav-title').textContent.trim();
      }
      renderTaskList();
    };
  });

  renderTaskList();

  // 2. Connect IPC if running inside Electron
  if (!window.faststreamAPI) {
    console.warn('[FastStream UI] window.faststreamAPI not detected. Running in standalone or fallback mode.');
    return;
  }

  try {
    // Load initial default directory & settings
    defaultDownloadDir = (await window.faststreamAPI.defaultDir()) || '';
    const settings = (await window.faststreamAPI.getSettings()) || {};
    if (settings.defaultDir) defaultDownloadDir = settings.defaultDir;

    $('#settingDefaultDir').value = defaultDownloadDir;
    $('#settingMaxConcurrent').value = settings.maxConcurrent || 3;
    $('#settingDefaultConn').value = settings.defaultConnections || 8;

    // Load existing task list
    const initialTasks = await window.faststreamAPI.list();
    if (Array.isArray(initialTasks)) {
      initialTasks.forEach(t => tasks.set(t.id, t));
    }
    renderTaskList();

    // Register real-time event listeners
    window.faststreamAPI.onTaskUpdate((snap) => {
      tasks.set(snap.id, snap);
      renderTaskList();
    });

    window.faststreamAPI.onTaskRemove((id) => {
      tasks.delete(id);
      const card = $(`[data-task-id="${id}"]`);
      if (card) card.remove();
      renderTaskList();
    });

    // Browser sniffer incoming task trigger
    window.faststreamAPI.onSniff((payload) => {
      openNewDownload(payload);
    });
  } catch (err) {
    console.error('[FastStream UI] Error during IPC initialization:', err);
  }
}

window.addEventListener('DOMContentLoaded', init);
