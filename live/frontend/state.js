const { api } = await import('./api.js');
let live = window.ORIA,
  data = live.data;
const find = (table, id) => (data[table] || []).find((r) => r.system_id === id) || {};
let campaign = data.campaign.find((r) => r.Status === 'TRUE'),
  characters = data.character.filter((r) => r.Campaign === campaign?.system_id),
  state = live.state,
  page = '角色',
  tab = '冒險裝備',
  selected =
    characters.find((r) => live.permissions[r.system_id]?.owner)?.system_id ||
    (live.role === 'dm' ? characters[0]?.system_id : undefined),
  undo = null,
  editing = null,
  pending = false,
  retryOperation = null;
function toast(s) {
  $('#toast').textContent = s;
  $('#toast').style.display = 'block';
  setTimeout(() => ($('#toast').style.display = 'none'), 6000);
}
function persist() {
  return false;
} // Gameplay data is never written to browser storage.
function stateFor(id) {
  return state.characters[id] || { hp: 0, temp: 0, will: 0, wounds: [] };
}
function current() {
  return stateFor(selected);
}
function perm(id = selected) {
  return live.permissions[id] || {};
}
let reloadPromise = null;
function selectableCharacters() {
  return live.role === 'dm' ? characters : characters.filter((c) => perm(c.system_id).owner);
}
function syncCharacterSelection() {
  const choices = selectableCharacters();
  if (!choices.some((c) => c.system_id === selected)) selected = choices[0]?.system_id;
  $('#character').innerHTML = choices
    .map((c) => `<option value="${esc(c.system_id)}">${esc(c['Character Name'])}</option>`)
    .join('');
  $('#character').value = selected || '';
  $('#character').disabled = !choices.length;
}
async function reloadLive() {
  if (reloadPromise) return reloadPromise;
  const button = $('#refreshLive'),
    indicator = $('#reloadSpinner'),
    message = $('#reloadStatus');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  indicator.hidden = false;
  message.textContent = '正在重新載入…';
  reloadPromise = (async () => {
    try {
      const fresh = await api('/api/bootstrap');
      window.ORIA = live = fresh;
      data = fresh.data;
      state = fresh.state;
      campaign = data.campaign.find((r) => r.Status === 'TRUE');
      characters = data.character;
      syncCharacterSelection();
      $('#campaign').textContent = campaign?.['Campaign Name (Chinese)'] || '目前沒有啟用戰役';
      render();
      message.textContent = '重新載入完成';
      return fresh;
    } catch (e) {
      message.textContent = '重新載入失敗：' + e.message;
      throw e;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      indicator.hidden = true;
      reloadPromise = null;
    }
  })();
  return reloadPromise;
}
function saved(message = '✓ 已儲存至伺服器') {
  $('#save').textContent = message;
}
async function mutate(fn, command) {
  if (pending || !perm().edit) return;
  const id = selected,
    before = structuredClone(current()),
    operationId = crypto.randomUUID();
  fn(current());
  pending = true;
  saved('儲存中…');
  render();
  await commitResource(id, before, operationId, command);
}
async function commitResource(id, before, operationId, command) {
  pending = true;
  let feedback = null;
  try {
    const result = await api(`/api/characters/${id}/resource`, {
      method: 'POST',
      body: { operationId, command },
    });
    state.characters[id] = result.state;
    live.permissions[id].version = result.version;
    undo = { selected: id, operationId };
    retryOperation = null;
    if (!result.replayed) feedback = command.kind;
    saved();
  } catch (e) {
    state.characters[id] = before;
    retryOperation = { id, before, operationId, command };
    saved('儲存未確認 · 請重試');
    toast(e.message);
    $('#retrySave').hidden = false;
  } finally {
    pending = false;
    render();
    if (selected === id && feedback) animateResourceFeedback(feedback);
  }
}
async function undoResource() {
  if (pending || !undo) return;
  const u = undo;
  pending = true;
  try {
    const r = await api(`/api/characters/${u.selected}/undo`, {
      method: 'POST',
      body: { operationId: u.operationId },
    });
    state.characters[u.selected] = r.state;
    live.permissions[u.selected].version = r.version;
    undo = null;
    saved();
  } catch (e) {
    toast(e.message);
  } finally {
    pending = false;
    render();
  }
}
const privateTimers = new Map();
let saveQueue = Promise.resolve();
function queuePrivate(id, field, value) {
  const key = id + ':' + field;
  clearTimeout(privateTimers.get(key));
  saved('尚有文字等待儲存…');
  privateTimers.set(
    key,
    setTimeout(() => {
      saveQueue = saveQueue.then(async () => {
        try {
          const r = await api(`/api/characters/${id}/private`, {
            method: 'PATCH',
            body: { field, value, version: perm(id).version },
          });
          live.permissions[id].version = r.version;
          state.characters[id][field] = value;
          saved();
        } catch (e) {
          saved('文字儲存失敗 · 草稿仍在本頁');
          toast(e.message);
        }
      });
    }, 700),
  );
}
function protectUI() {
  const p = perm();
  for (const id of ['hit', 'temp', 'pray', 'stabilize'])
    if ($('#' + id))
      $('#' + id).disabled = pending || !p.edit || (id === 'pray' && current().will < 1);
  if ($('#undo')) $('#undo').disabled = pending || !p.edit || undo?.selected !== selected;
  $$('[data-settle],[data-stop]').forEach((b) => (b.disabled = pending || !p.edit));
  for (const key of ['inventory', 'general'])
    if ($('#' + key)) {
      if (!p.private) {
        $('#' + key).closest('section').hidden = true;
      } else $('#' + key).readOnly = !p.edit;
    }
  for (const id of ['quicknote', 'newSession', 'resumeSession', 'newnote'])
    if ($('#' + id)) $('#' + id).disabled = !p.notesWrite;
  if (page === '日誌' && !p.private)
    $('#content').innerHTML = '<p class="empty">私人筆記不開放閱讀</p>';
  syncCharacterSelection();
  if ($('#ownerConsoleButton')) $('#ownerConsoleButton').hidden = !live.isOwner;
  if ($('#adminPanel')) $('#adminPanel').hidden = !live.isDM;
  if ($('#newCharacter')) $('#newCharacter').hidden = !['player', 'dm'].includes(live.role);
  if ($('#reselectCharacter')) $('#reselectCharacter').hidden = !(p.editClass || p.editSpells);
  if ($('#growthCharacter')) $('#growthCharacter').hidden = !p.owner;
  if ($('#editLoadout')) $('#editLoadout').hidden = !p.edit;
}
const controls = document.createElement('div');
controls.className = 'live-controls';
controls.innerHTML =
  '<button id="refreshLive">重新載入 <span id="reloadSpinner" class="reload-spinner" aria-hidden="true" hidden></span></button><span id="reloadStatus" class="reload-status" role="status" aria-live="polite"></span><button id="retrySave" hidden>重試未確認操作</button><button id="newCharacter">建立角色</button><button id="reselectCharacter" hidden>修改角色選擇</button><button id="editLoadout" hidden>調整武器／信仰</button><button id="growthCharacter" hidden>分配成長點</button><button id="adminPanel">DM 管理</button><button id="ownerConsoleButton" hidden>典藏管理室</button><button id="logout">登出</button>';
const toolbar = $('.heading > .row');
toolbar.classList.add('adventure-toolbar');
toolbar.prepend(controls);
$('#save').textContent = '已連線至伺服器';
const actionGlyphs = {
  refreshLive: '⟳',
  retrySave: '↻',
  newCharacter: '✦',
  reselectCharacter: '⚔',
  editLoadout: '⚒',
  growthCharacter: '✧',
  adminPanel: '♜',
  ownerConsoleButton: '✺',
  logout: '↗',
};
for (const [id, glyph] of Object.entries(actionGlyphs)) {
  const button = $('#' + id),
    icon = document.createElement('span');
  icon.className = 'action-glyph';
  icon.textContent = glyph;
  icon.setAttribute('aria-hidden', 'true');
  button.prepend(icon);
}
$('#newCharacter').hidden = !['player', 'dm'].includes(live.role);
$('#adminPanel').hidden = !live.isDM;
$('#refreshLive').onclick = () =>
  reloadLive()
    .then(() => toast('重新載入完成'))
    .catch((e) => toast(e.message));
$('#retrySave').onclick = async () => {
  if (!retryOperation) return;
  const r = retryOperation;
  await commitResource(r.id, r.before, r.operationId, r.command);
  $('#retrySave').hidden = !!retryOperation ? false : true;
};
$('#logout').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST', body: {} });
  location.reload();
};
// Menus use the same definitions and server validation as existing characters.
$('#newCharacter').onclick = () => openCharacterForm();
$('#adminPanel').onclick = () => openAdmin();

$('#reselectCharacter').onclick = () => openReselect();
$('#growthCharacter').onclick = () => openGrowth();
$('#editLoadout').onclick = () => openLoadout();

$('#ownerConsoleButton').hidden = !live.isOwner;
$('#ownerConsoleButton').onclick = async () => {
  try {
    const { openOwnerConsole } = await import('./owner-console.js');
    await openOwnerConsole({ api, onChange: reloadLive });
  } catch (e) {
    toast(e.message);
  }
};
