'use strict';

/**
 * FastStream Desktop UI Controller
 * 100% Brand-new, self-contained, high-performance UI implementation
 */

const tasks = new Map();
const selectedTaskIds = new Set();
let contextTaskId = null;
let currentFilter = 'all';
let currentCategory = null;
let defaultDownloadDir = '';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// Helper: Get list of selected tasks
function getSelectedTasks() {
  return Array.from(selectedTaskIds)
    .map((id) => tasks.get(id))
    .filter(Boolean);
}

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
  $('#badgeDownloading').textContent = Array.from(tasks.values()).filter(t => ['downloading', 'connecting', 'merging'].includes(t.status)).length;
  $('#badgeDone').textContent = Array.from(tasks.values()).filter(t => t.status === 'done').length;
  $('#badgePaused').textContent = Array.from(tasks.values()).filter(t => t.status === 'paused').length;

  // Calculate total aggregate speed
  const totalSpeed = Array.from(tasks.values())
    .filter(t => t.status === 'downloading')
    .reduce((acc, t) => acc + (t.speed || 0), 0);
  $('#totalSpeedVal').textContent = fmtSpeed(totalSpeed);

  // Update Bottom Statusbar
  const statusCount = $('#statusCountText');
  if (statusCount) statusCount.textContent = `${tasks.size} 个任务`;
  const statusSpeed = $('#statusSpeedText');
  if (statusSpeed) statusSpeed.textContent = `总速度: ${fmtSpeed(totalSpeed)}`;

  if (filtered.length === 0) {
    empty.style.display = 'flex';
    const cards = container.querySelectorAll('.task-card');
    cards.forEach(c => c.remove());
    return;
  }

  empty.style.display = 'none';

  // Build / update cards
  filtered.forEach((task) => {
    let card = container.querySelector(`[data-task-id="${task.id}"]`);
    const pct = task.size ? Math.min(100, Math.round((task.downloaded / task.size) * 100)) : 0;
    const isSelected = selectedTaskIds.has(task.id);

    if (!card) {
      card = document.createElement('div');
      card.className = 'task-card';
      card.setAttribute('data-task-id', task.id);
      container.appendChild(card);
    }

    if (isSelected) card.classList.add('selected');
    else card.classList.remove('selected');

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
        <input type="checkbox" class="col-check task-check" data-id="${task.id}" ${isSelected ? 'checked' : ''}>
        <div class="col col-name">
          <div class="task-filename" title="${task.filename}">${task.filename}</div>
          <div class="task-url" title="${task.error || task.url}">
            ${task.error ? `<span style="color:#ef4444; font-weight: 500;">[${task.error}]</span> ` : ''}${task.url}
          </div>
        </div>
        <div class="col col-size">${fmtBytes(task.downloaded)} / ${fmtBytes(task.size)}</div>
        <div class="col col-status">
          <span class="status-pill status-${task.status}" title="${task.error || ''}">${task.status.toUpperCase()}</span>
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
            <button class="btn btn-secondary btn-icon btn-action-toggle" data-id="${task.id}" title="${isRunning ? '暂停' : '恢复'}">
              ${isRunning ? '⏸️' : '▶️'}
            </button>
          ` : `
            <button class="btn btn-secondary btn-icon btn-action-open" data-id="${task.id}" title="打开文件">
              📂
            </button>
          `}
          <button class="btn btn-secondary btn-icon btn-action-delete" data-id="${task.id}" title="删除任务">
            🗑️
          </button>
        </div>
      </div>
    `;

    // Row selection on click
    card.onclick = (e) => {
      if (e.target.closest('button') || e.target.closest('input[type="checkbox"]')) return;
      if (selectedTaskIds.has(task.id)) selectedTaskIds.delete(task.id);
      else selectedTaskIds.add(task.id);
      renderTaskList();
    };

    // Checkbox selection
    const chk = card.querySelector('.task-check');
    if (chk) {
      chk.onchange = (e) => {
        if (e.target.checked) selectedTaskIds.add(task.id);
        else selectedTaskIds.delete(task.id);
        renderTaskList();
      };
    }

    // Double-click row: Open file or toggle pause/resume
    card.ondblclick = () => {
      if (task.status === 'done') {
        window.faststreamAPI?.openFile(task.dir + '/' + task.filename);
      } else if (isRunning) {
        window.faststreamAPI?.pause(task.id);
      } else {
        if (task.status === 'error') window.faststreamAPI?.restart(task.id);
        else window.faststreamAPI?.resume(task.id);
      }
    };

    // Right-click context menu
    card.oncontextmenu = (e) => {
      e.preventDefault();
      selectedTaskIds.clear();
      selectedTaskIds.add(task.id);
      contextTaskId = task.id;
      renderTaskList();

      const menu = $('#contextMenu');
      if (menu) {
        menu.style.left = `${Math.min(window.innerWidth - 180, e.clientX)}px`;
        menu.style.top = `${Math.min(window.innerHeight - 220, e.clientY)}px`;
        menu.classList.add('show');
      }
    };

    // Action toggle button
    const btnToggle = card.querySelector('.btn-action-toggle');
    if (btnToggle) {
      btnToggle.onclick = (e) => {
        e.stopPropagation();
        if (isRunning) window.faststreamAPI?.pause(task.id);
        else if (task.status === 'error') window.faststreamAPI?.restart(task.id);
        else window.faststreamAPI?.resume(task.id);
      };
    }

    // Action open file button
    const btnOpen = card.querySelector('.btn-action-open');
    if (btnOpen) {
      btnOpen.onclick = (e) => {
        e.stopPropagation();
        window.faststreamAPI?.openFile(task.dir + '/' + task.filename);
      };
    }

    // Action delete button
    const btnDel = card.querySelector('.btn-action-delete');
    if (btnDel) {
      btnDel.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`确定要移除任务 "${task.filename}" 吗？`)) {
          window.faststreamAPI?.remove(task.id, false);
          tasks.delete(task.id);
          selectedTaskIds.delete(task.id);
          card.remove();
          renderTaskList();
        }
      };
    }
  });

  // Sync #selectAll checkbox
  const selectAll = $('#selectAll');
  if (selectAll) {
    const allVisible = filtered.length > 0 && filtered.every(t => selectedTaskIds.has(t.id));
    selectAll.checked = allVisible;
  }
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

  // 1. Bind Toolbar Actions (8 大核心命令工具栏)
  const handleOpenNew = async () => {
    let clipboardText = '';
    try {
      if (window.faststreamAPI?.clipboardRead) {
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

  // 按钮 1: 添加URL
  const btnOpenNew = $('#btnOpenNew');
  if (btnOpenNew) btnOpenNew.onclick = handleOpenNew;
  const btnEmptyNew = $('#btnEmptyNew');
  if (btnEmptyNew) btnEmptyNew.onclick = handleOpenNew;

  // 按钮 2: 恢复 (Resume)
  const btnResume = $('#btnResume');
  if (btnResume) {
    btnResume.onclick = () => {
      const selected = getSelectedTasks();
      const targets = selected.length > 0 ? selected : Array.from(tasks.values());
      let count = 0;
      targets.forEach(t => {
        if (t.status === 'paused') {
          window.faststreamAPI?.resume(t.id);
          count++;
        } else if (t.status === 'error') {
          window.faststreamAPI?.restart(t.id);
          count++;
        }
      });
      if (count === 0 && selected.length === 0) {
        alert('没有需要恢复的任务。');
      }
    };
  }

  // 按钮 3: 暂停 (Pause)
  const btnPause = $('#btnPause');
  if (btnPause) {
    btnPause.onclick = () => {
      const selected = getSelectedTasks();
      if (selected.length === 0) {
        // 若未选，暂停第一个正在下载的任务
        const running = Array.from(tasks.values()).find(t => ['downloading', 'connecting'].includes(t.status));
        if (running) window.faststreamAPI?.pause(running.id);
        else alert('请先勾选或点击选中要暂停的下载任务。');
        return;
      }
      selected.forEach(t => {
        if (['downloading', 'connecting', 'merging'].includes(t.status)) {
          window.faststreamAPI?.pause(t.id);
        }
      });
    };
  }

  // 按钮 4: 全部暂停 (Pause All)
  const btnPauseAll = $('#btnPauseAll');
  if (btnPauseAll) {
    btnPauseAll.onclick = () => {
      let count = 0;
      tasks.forEach(t => {
        if (['downloading', 'connecting', 'merging'].includes(t.status)) {
          window.faststreamAPI?.pause(t.id);
          count++;
        }
      });
      if (count === 0) alert('当前没有正在进行的下载任务。');
    };
  }

  // 按钮 5: 删除 (Delete)
  const btnDelete = $('#btnDelete');
  if (btnDelete) {
    btnDelete.onclick = () => {
      const selected = getSelectedTasks();
      if (selected.length === 0) {
        alert('请先勾选或点击选中要删除的任务。');
        return;
      }
      if (confirm(`确定要移除选中的 ${selected.length} 个下载任务吗？`)) {
        selected.forEach(t => {
          window.faststreamAPI?.remove(t.id, false);
          tasks.delete(t.id);
          selectedTaskIds.delete(t.id);
        });
        renderTaskList();
      }
    };
  }

  // 按钮 6: 打开文件 (Open File)
  const btnOpenFile = $('#btnOpenFile');
  if (btnOpenFile) {
    btnOpenFile.onclick = () => {
      const selected = getSelectedTasks();
      if (selected.length === 0) {
        alert('请先选中一个已完成的下载任务。');
        return;
      }
      const doneTask = selected.find(t => t.status === 'done');
      if (doneTask) {
        window.faststreamAPI?.openFile(doneTask.dir + '/' + doneTask.filename);
      } else {
        alert('选中的任务尚未下载完成，无法打开。');
      }
    };
  }

  // 按钮 7: 打开文件夹 (Open Folder / Reveal in Finder)
  const btnOpenFolder = $('#btnOpenFolder');
  if (btnOpenFolder) {
    btnOpenFolder.onclick = () => {
      const selected = getSelectedTasks();
      if (selected.length > 0) {
        const t = selected[0];
        window.faststreamAPI?.showInFolder(t.dir + '/' + t.filename);
      } else {
        window.faststreamAPI?.openFolder(defaultDownloadDir);
      }
    };
  }

  // 按钮 8: 选项 (Settings)
  const btnOpenSettings = $('#btnOpenSettings');
  if (btnOpenSettings) btnOpenSettings.onclick = () => showModal('#modalSettings');
  $('#btnCloseSettingsModal').onclick = () => hideModal('#modalSettings');
  $('#btnCloseNewModal').onclick = () => hideModal('#modalNewDownload');
  $('#btnCancelDownload').onclick = () => hideModal('#modalNewDownload');

  // Select All Checkbox
  const selectAll = $('#selectAll');
  if (selectAll) {
    selectAll.onchange = (e) => {
      if (e.target.checked) {
        tasks.forEach(t => selectedTaskIds.add(t.id));
      } else {
        selectedTaskIds.clear();
      }
      renderTaskList();
    };
  }

  // Context Menu Interactions
  document.addEventListener('click', (e) => {
    const menu = $('#contextMenu');
    if (menu && !menu.contains(e.target)) {
      menu.classList.remove('show');
    }
  });

  $('#ctxOpen').onclick = () => {
    if (contextTaskId) {
      const t = tasks.get(contextTaskId);
      if (t && t.status === 'done') window.faststreamAPI?.openFile(t.dir + '/' + t.filename);
      else alert('该任务尚未下载完成。');
    }
  };

  $('#ctxShowFolder').onclick = () => {
    if (contextTaskId) {
      const t = tasks.get(contextTaskId);
      if (t) window.faststreamAPI?.showInFolder(t.dir + '/' + t.filename);
    }
  };

  $('#ctxResume').onclick = () => {
    if (contextTaskId) {
      const t = tasks.get(contextTaskId);
      if (t?.status === 'error') window.faststreamAPI?.restart(t.id);
      else if (t) window.faststreamAPI?.resume(t.id);
    }
  };

  $('#ctxPause').onclick = () => {
    if (contextTaskId) window.faststreamAPI?.pause(contextTaskId);
  };

  $('#ctxCopyUrl').onclick = () => {
    if (contextTaskId) {
      const t = tasks.get(contextTaskId);
      if (t) window.faststreamAPI?.clipboardWrite(t.url);
    }
  };

  $('#ctxDelete').onclick = () => {
    if (contextTaskId) {
      const t = tasks.get(contextTaskId);
      if (t && confirm(`确定要移除任务 "${t.filename}" 并清理文件吗？`)) {
        window.faststreamAPI?.remove(t.id, true);
        tasks.delete(t.id);
        selectedTaskIds.delete(t.id);
        renderTaskList();
      }
    }
  };

  // Input changes
  const checkVideoTip = (url) => {
    const tip = $('#videoPageTip');
    if (!tip) return;
    const isVideoPage = url.includes('youtube.com/watch') || url.includes('youtu.be/') || url.includes('bilibili.com/video');
    tip.style.display = isVideoPage ? 'block' : 'none';
  };

  $('#inputUrl').addEventListener('input', () => {
    const url = $('#inputUrl').value.trim();
    checkVideoTip(url);
    if (url && !$('#inputFilename').value) {
      const detected = nameFromUrl(url);
      $('#inputFilename').value = detected;
      $('#selectCategory').value = guessCategory(detected);
    }
  });

  const btnSampleVideo = $('#btnSampleVideo');
  if (btnSampleVideo) {
    btnSampleVideo.onclick = () => {
      const sampleUrl = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4';
      $('#inputUrl').value = sampleUrl;
      $('#inputFilename').value = 'Big_Buck_Bunny_720p_5MB.mp4';
      $('#selectCategory').value = '视频';
      checkVideoTip(sampleUrl);
    };
  }

  const btnSampleSpeed = $('#btnSampleSpeed');
  if (btnSampleSpeed) {
    btnSampleSpeed.onclick = () => {
      const sampleUrl = 'https://speed.cloudflare.com/__down?bytes=10485760';
      $('#inputUrl').value = sampleUrl;
      $('#inputFilename').value = 'cloudflare_speedtest_10mb.bin';
      $('#selectCategory').value = '常规';
      checkVideoTip(sampleUrl);
    };
  }

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
      selectedTaskIds.delete(id);
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
