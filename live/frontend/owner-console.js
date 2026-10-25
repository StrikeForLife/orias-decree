/** Owner-only graphical editor. All permissions and references are rechecked by API. */
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const kinds = {
  spell: ['法術', '✧'],
  school: ['法源道', '◈'],
  class: ['職業', '♜'],
  weapon: ['武器', '⚔'],
  beliefs: ['信仰', '❖'],
  background: ['出身', '⌖'],
};
const title = (p) =>
  p['Spell Name (Chinese)'] ||
  p['School Name (Chinese)'] ||
  p['Class Name (Chinese)'] ||
  p['Weapon Name'] ||
  p.Name ||
  '未命名';
const short = (p) => title(p).split(/\s+[A-Za-z]/)[0];
// Entry IDs are public identifiers. getRandomValues also supports local HTTP QA.
const newId = () =>
  crypto.randomUUID?.() ||
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
const schemas = {
  spell: [
    ['Spell Name (Chinese)', '中文名稱'],
    ['Spell Name (English)', '英文名稱'],
    ['School', '所屬法源道', 'ref', 'school'],
    ['Action Type', '動作類型'],
    ['Target', '目標／範圍'],
    ['Exclusive', '專屬限制', 'exclusive'],
    ['Spell Desc', '法術描述', 'area'],
  ],
  school: [
    ['School Name (Chinese)', '中文名稱'],
    ['School Name (English)', '英文名稱'],
    ['Class', '所屬職業', 'ref', 'class'],
    ['Belief', '信仰', 'ref', 'beliefs'],
    ['Main Spell', '核心法術', 'ref', 'spell'],
    ['Title', '理念／稱號'],
    ['Passive', '被動能力', 'area'],
    ['Desc', '法源道介紹', 'area'],
  ],
  class: [
    ['Class Name (Chinese)', '中文名稱'],
    ['Class Name (English)', '英文名稱'],
    ['Short Desc', '職業定位'],
    ['Faction', '所屬陣營'],
    ['Speed', '速度'],
    ['Class Desc', '職業介紹', 'area'],
    ...Array.from({ length: 8 }, (_, i) => [`Level ${i + 1} Perk`, `${i + 1} 級能力`, 'area']),
  ],
  weapon: [
    ['Weapon Name', '武器名稱'],
    ['Weapon Type', '武器類型', 'weaponType'],
    ['Damage', '傷害骰／數值'],
    ['Effect', '效果', 'area'],
    ['Reveal Effect', '公開效果', 'boolean'],
    ['Available', '可選用', 'boolean'],
  ],
  beliefs: [
    ['Name', '名稱（可含英文）'],
    ['Title', '尊稱'],
    ['Quote', '箴言', 'area'],
    ['Desc', '信仰介紹', 'area'],
    ['Enable', '可選用', 'boolean'],
    ['Belief Effect 1', '祈禱效果一', 'area'],
    ['Belief Effect 2', '祈禱效果二', 'area'],
  ],
  background: [
    ['Name', '出身名稱（可含英文）'],
    ['Main Branch', '地區／勢力'],
    ['Personality', '性格／特色'],
    ['Desc', '出身介紹', 'area'],
    ['Skill 1', '能力一', 'area'],
    ['Skill 2', '能力二', 'area'],
  ],
};
const actions = {
  'content.create': '新增內容',
  'content.update': '修改內容',
  'content.archive': '刪除內容',
  'content.restore': '復原內容',
  'member.player': '設定玩家',
  'member.dm': '設定 DM',
  'member.reader': '撤銷權限',
  'campaign.create': '新增戰役',
  'campaign.update': '修改戰役',
};

export async function openOwnerConsole({ api, onChange = async () => {} }) {
  let dialog = document.querySelector('#ownerConsole');
  if (dialog?.open) return;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'ownerConsole';
    document.body.append(dialog);
  }
  let model,
    view = 'catalog',
    kind = 'spell',
    selected = null,
    query = '',
    archived = false,
    draft = null,
    dirty = false,
    busy = false,
    campaignId = null;
  const $ = (s) => dialog.querySelector(s),
    $$ = (s) => [...dialog.querySelectorAll(s)];
  const changed = () => {
    dirty = true;
    if ($('#ownerDirty')) $('#ownerDirty').textContent = '尚未儲存';
  };
  const leave = () => !dirty || confirm('仍有未儲存的內容，要放棄這些修改？');
  const error = (e) => {
    const n = $('#ownerMessage');
    if (n) {
      n.textContent = e.message || String(e);
      n.className = 'owner-message error';
    } else alert(e.message || String(e));
  };
  const notify = (message) => {
    if ($('#ownerMessage')) {
      $('#ownerMessage').textContent = message;
      $('#ownerMessage').className = 'owner-message success';
    }
  };
  const load = async () => {
    model = await api('/api/owner/bootstrap');
    campaignId = model.campaigns.some((c) => c.id === campaignId)
      ? campaignId
      : model.campaigns.find((c) => c.active)?.id || model.campaigns[0]?.id;
  };
  async function write(path, body, message) {
    if (busy) return false;
    busy = true;
    $$('button[type="submit"], [data-owner-write]').forEach((b) => (b.disabled = true));
    try {
      const r = await api(path, { method: 'POST', body });
      dirty = false;
      if (r.signInAgain) {
        alert('權限已更新，請重新登入。');
        location.reload();
        return true;
      }
      await load();
      await onChange();
      paint();
      notify(message);
      return true;
    } catch (e) {
      error(e);
      return false;
    } finally {
      busy = false;
      $$('button[type="submit"], [data-owner-write]').forEach((b) => (b.disabled = false));
    }
  }
  const choose = (item) => {
    selected = item ? kind + ':' + item.id : null;
    draft = item ? structuredClone(item) : null;
    dirty = false;
  };
  function shell() {
    dialog.innerHTML = `<div class="owner-shell"><header class="owner-header"><div class="owner-seal">✺</div><div><p class="owner-eyebrow">THE KEEPER’S DESK</p><h1>典藏管理室</h1><p>網站擁有者專用 · ${escape(model.owner.email)}</p></div><button id="ownerClose" aria-label="關閉管理室">關閉 ✕</button></header><nav class="owner-tabs" aria-label="管理分類">${[
      ['catalog', '典籍內容'],
      ['members', '玩家與權限'],
      ['campaigns', '戰役'],
      ['audit', '變更紀錄'],
    ]
      .map(
        ([id, label]) =>
          `<button data-owner-tab="${id}" aria-pressed="${view === id}" class="${view === id ? 'active' : ''}">${label}</button>`,
      )
      .join(
        '',
      )}</nav><div id="ownerMessage" class="owner-message" role="status" aria-live="polite"></div><section id="ownerBody"></section><footer class="owner-footer"><span>修改直接寫入 D1 · 保留變更紀錄</span><span>網站擁有權獨立於 DM 權限</span></footer></div>`;
    $('#ownerClose').onclick = () => {
      if (leave()) dialog.close();
    };
    $$('[data-owner-tab]').forEach(
      (b) =>
        (b.onclick = () => {
          if (!leave()) return;
          dirty = false;
          view = b.dataset.ownerTab;
          draft = null;
          paint();
        }),
    );
  }
  function paint() {
    shell();
    ({
      catalog: paintCatalog,
      members: paintMembers,
      campaigns: paintCampaigns,
      audit: paintAudit,
    })[view]();
  }
  function field([key, label, type, reference], payload) {
    const val = payload[key] ?? '';
    let input;
    if (type === 'area')
      input = `<textarea data-owner-field="${escape(key)}" rows="${key.includes('Desc') || key === 'Desc' ? 7 : 3}" maxlength="80000">${escape(val)}</textarea>`;
    else if (type === 'ref') {
      let options = model.catalog.filter((x) => x.kind === reference && !x.archived);
      if (key === 'Main Spell')
        options = options.filter((x) => x.payload.School === payload.system_id);
      input = `<select data-owner-field="${escape(key)}"><option value="">— 尚未指定 —</option>${options.map((x) => `<option value="${escape(x.id)}" ${x.id === val ? 'selected' : ''}>${escape(short(x.payload))}</option>`).join('')}</select>`;
    } else if (type === 'boolean')
      input = `<select data-owner-field="${escape(key)}"><option value="TRUE" ${val === 'TRUE' ? 'selected' : ''}>是</option><option value="FALSE" ${val !== 'TRUE' ? 'selected' : ''}>否</option></select>`;
    else if (type === 'exclusive')
      input = `<select data-owner-field="${escape(key)}"><option value="" ${!val ? 'selected' : ''}>非專屬</option><option value="${escape(val || 'Exclusive')}" ${val ? 'selected' : ''}>專屬</option></select>`;
    else if (type === 'weaponType')
      input = `<select data-owner-field="${escape(key)}">${['主武器 Main Weapon', '重型武器 Heavy Weapon', '副武器 Sidearm', '非武器 Non-weapon'].map((x) => `<option ${x === val ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
    else
      input = `<input data-owner-field="${escape(key)}" value="${escape(val)}" maxlength="${key === 'Speed' ? 20 : 1000}">`;
    return `<label class="${type === 'area' ? 'wide' : ''}"><span>${escape(label)}</span>${input}</label>`;
  }
  function paintCatalog() {
    const list = model.catalog.filter(
      (x) =>
        x.kind === kind &&
        !!x.archived === archived &&
        (!query || JSON.stringify(x.payload).toLowerCase().includes(query.toLowerCase())),
    );
    $('#ownerBody').innerHTML =
      `<div class="owner-catalog-bar"><div class="owner-kinds">${Object.entries(kinds)
        .map(
          ([k, [name, icon]]) =>
            `<button data-owner-kind="${k}" class="${k === kind ? 'active' : ''}">${icon} ${name}</button>`,
        )
        .join(
          '',
        )}</div><button id="ownerExport">匯出典籍 JSON</button></div><div class="owner-workspace"><aside class="owner-index"><div class="owner-index-tools"><input id="ownerSearch" aria-label="搜尋典籍" placeholder="搜尋${kinds[kind][0]}…" value="${escape(query)}"><div class="owner-index-meta"><label><input id="ownerArchived" type="checkbox" ${archived ? 'checked' : ''}> 已刪除</label><span>${list.length} 項</span></div><button id="ownerNew" class="owner-add">＋ 新增${kinds[kind][0]}</button></div><div class="owner-records">${list.map((x) => `<button data-owner-record="${escape(x.id)}" class="owner-record ${selected === kind + ':' + x.id ? 'active' : ''}"><span class="owner-record-icon">${kinds[kind][1]}</span><span><strong>${escape(short(x.payload))}</strong><small>${escape(x.payload['Action Type'] || x.payload.Title || x.payload['Weapon Type'] || kinds[kind][0])}</small></span></button>`).join('') || '<p class="owner-empty">沒有符合的條目</p>'}</div></aside><div id="ownerEditor" class="owner-editor"></div></div>`;
    $$('[data-owner-kind]').forEach(
      (b) =>
        (b.onclick = () => {
          if (!leave()) return;
          kind = b.dataset.ownerKind;
          query = '';
          choose(null);
          paint();
        }),
    );
    $('#ownerSearch').oninput = (e) => {
      query = e.target.value;
      const input = e.target,
        start = input.selectionStart;
      const currentDraft = draft,
        currentDirty = dirty;
      paintCatalog();
      draft = currentDraft;
      dirty = currentDirty;
      $('#ownerSearch').focus();
      $('#ownerSearch').setSelectionRange(start, start);
    };
    $('#ownerArchived').onchange = (e) => {
      if (!leave()) {
        e.target.checked = archived;
        return;
      }
      archived = e.target.checked;
      choose(null);
      paint();
    };
    $('#ownerNew').onclick = () => {
      if (!leave()) return;
      archived = false;
      const payload = { system_id: kind + '_' + newId() };
      for (const [key, , type] of schemas[kind])
        payload[key] =
          type === 'boolean' ? 'TRUE' : type === 'weaponType' ? '主武器 Main Weapon' : '';
      draft = { kind, id: payload.system_id, payload, version: null, archived: 0 };
      selected = kind + ':' + draft.id;
      dirty = true;
      paint();
    };
    $$('[data-owner-record]').forEach(
      (b) =>
        (b.onclick = () => {
          if (!leave()) return;
          choose(model.catalog.find((x) => x.kind === kind && x.id === b.dataset.ownerRecord));
          paint();
        }),
    );
    $('#ownerExport').onclick = () => {
      const content = {
        format: 'oria-owner-catalog-v1',
        exportedAt: new Date().toISOString(),
        items: model.catalog,
      };
      const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = 'oria-catalog-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('已匯出典籍。這份 JSON 不包含角色及筆記；完整 D1 備份仍使用維護工具。');
    };
    if (!draft) {
      $('#ownerEditor').innerHTML =
        `<div class="owner-editor-empty"><span>${kinds[kind][1]}</span><h2>選擇一項${kinds[kind][0]}</h2><p>在左側選取內容，或建立新的條目。</p><p>已被使用的關聯受到保護；刪除可復原。</p></div>`;
      return;
    }
    const current = draft;
    $('#ownerEditor').innerHTML =
      `<form id="ownerContentForm"><div class="owner-editor-heading"><div><p class="owner-eyebrow">${current.version === null ? 'NEW ENTRY' : 'EDIT ARCHIVE'}</p><h2>${escape(short(current.payload))}</h2></div><span id="ownerDirty" class="owner-save-status">${dirty ? '尚未儲存' : current.archived ? '已刪除' : '已儲存'}</span></div><div class="owner-id">固定 ID · ${escape(current.id)}</div>${current.archived ? '<div class="owner-notice">此內容已從典籍隱藏，可在下方復原。</div>' : '<p class="owner-help">名稱與效果文字可直接修改；已被引用的職業、法源道及核心法術關聯需另行遷移。效果文字不會自動重算角色數值。</p>'}<fieldset ${current.archived ? 'disabled' : ''}><div class="owner-fields">${schemas[kind].map((f) => field(f, current.payload)).join('')}</div></fieldset><div class="owner-actions">${current.archived ? '<button type="button" id="ownerRestore" data-owner-write>復原內容</button>' : '<button type="submit" class="owner-primary">儲存變更</button>'}${current.version !== null && !current.archived ? '<button type="button" id="ownerArchive" class="owner-danger" data-owner-write>刪除內容</button>' : ''}<span>保留歷史紀錄</span></div></form>`;
    $$('[data-owner-field]').forEach(
      (el) =>
        (el.oninput = () => {
          current.payload[el.dataset.ownerField] = el.value;
          changed();
        }),
    );
    $('#ownerContentForm').onsubmit = async (e) => {
      e.preventDefault();
      const ok = await write(
        '/api/owner/content',
        { kind, id: current.id, version: current.version, payload: current.payload },
        '內容已儲存；玩家重新整理後即可看到。',
      );
      if (ok) {
        choose(model.catalog.find((x) => x.kind === kind && x.id === current.id));
        paint();
        notify('內容已儲存；玩家重新整理後即可看到。');
      }
    };
    const archive = async (flag) => {
      if (
        flag &&
        !confirm(
          '刪除「' + short(current.payload) + '」？可從已刪除區復原，仍被引用的內容會阻止刪除。',
        )
      )
        return;
      if (
        await write(
          '/api/owner/content/archive',
          { kind, id: current.id, version: current.version, archived: flag },
          flag ? '已移到已刪除區' : '內容已復原',
        )
      ) {
        choose(null);
        paint();
        notify(flag ? '已移到已刪除區，可隨時復原。' : '內容已復原。');
      }
    };
    if ($('#ownerArchive')) $('#ownerArchive').onclick = () => archive(true);
    if ($('#ownerRestore')) $('#ownerRestore').onclick = () => archive(false);
  }
  function campaignOptions() {
    return model.campaigns
      .map(
        (c) =>
          `<option value="${escape(c.id)}" ${campaignId === c.id ? 'selected' : ''}>${escape(c.name)}${c.active ? '（啟用中）' : ''}</option>`,
      )
      .join('');
  }
  function paintMembers() {
    const members = model.members.filter((m) => m.campaign_id === campaignId);
    $('#ownerBody').innerHTML =
      `<div class="owner-section-title"><p class="owner-eyebrow">KEEPERS & COMPANIONS</p><h2>玩家與權限</h2><p>每個戰役獨立授權。DM 不會自動取得這個管理後台。</p></div><label class="owner-campaign-filter">管理戰役<select id="ownerMemberCampaign">${campaignOptions()}</select></label><form id="ownerInvite" class="owner-invite"><label>Google 帳號電郵<input id="ownerInviteEmail" type="email" required placeholder="player@gmail.com" maxlength="254"></label><label>權限<select id="ownerInviteRole"><option value="player">玩家</option><option value="dm">DM</option></select></label><button type="submit" class="owner-primary" ${!campaignId ? 'disabled' : ''}>新增授權</button></form><div class="owner-notice">新增授權後，請對方重新登入認領；不會自動寄信。若 Google OAuth 仍在測試中，也需加入 Test users。撤銷權限後仍可唯讀查看公開角色卡，角色與筆記會保留。</div><div class="owner-member-list">${members.map((m, i) => `<section class="owner-member"><div class="owner-avatar">${m.role === 'dm' ? '♜' : '◈'}</div><div class="owner-member-info"><strong>${escape(m.email)}</strong><small>${m.claimed ? '已登入認領' : '等待首次登入'}</small></div><label class="owner-role-label"><span class="sr-only">${escape(m.email)} 的權限</span><select data-owner-role="${i}"><option value="player" ${m.role === 'player' ? 'selected' : ''}>玩家</option><option value="dm" ${m.role === 'dm' ? 'selected' : ''}>DM</option></select></label><button data-member-save="${i}" data-owner-write>儲存</button><button data-member-remove="${i}" class="owner-danger" data-owner-write>撤銷權限</button></section>`).join('') || '<p class="owner-empty">這個戰役尚未有授權名單。</p>'}</div>`;
    $('#ownerMemberCampaign').onchange = (e) => {
      campaignId = e.target.value;
      paint();
    };
    $('#ownerInvite').onsubmit = async (e) => {
      e.preventDefault();
      const email = $('#ownerInviteEmail').value.trim().toLowerCase();
      if (model.members.some((m) => m.campaign_id === campaignId && m.email === email))
        return error(new Error('此帳號已有權限，請在下方修改。'));
      await write(
        '/api/owner/member',
        { campaignId, email, role: $('#ownerInviteRole').value, id: null, version: null },
        '已新增授權，請玩家重新登入。',
      );
    };
    $$('[data-member-save]').forEach(
      (b) =>
        (b.onclick = () => {
          const i = Number(b.dataset.memberSave),
            m = members[i];
          return write(
            '/api/owner/member',
            {
              campaignId,
              email: m.email,
              id: m.id,
              version: m.version,
              role: $(`[data-owner-role="${i}"]`).value,
            },
            '權限已更新，該帳號需要重新登入。',
          );
        }),
    );
    $$('[data-member-remove]').forEach(
      (b) =>
        (b.onclick = () => {
          const m = members[Number(b.dataset.memberRemove)];
          if (confirm('撤銷 ' + m.email + ' 在此戰役的權限？角色及私人筆記會保留。'))
            return write(
              '/api/owner/member',
              { campaignId, email: m.email, id: m.id, version: m.version, role: 'reader' },
              '已撤銷授權，保留唯讀公開卡權限。',
            );
        }),
    );
  }
  function paintCampaigns() {
    $('#ownerBody').innerHTML =
      `<div class="owner-section-title"><p class="owner-eyebrow">WORLDS IN MOTION</p><h2>戰役典藏</h2><p>編輯戰役名稱與介紹。啟用／停用仍在 DM 管理中操作。</p></div><div class="owner-campaign-list">${model.campaigns.map((c) => `<button data-owner-campaign="${escape(c.id)}"><strong>${escape(c.name)}</strong><small>${c.active ? '啟用中' : '未啟用'}</small></button>`).join('')}<button id="ownerNewCampaign">＋ 新增戰役</button></div><div id="ownerCampaignEditor"></div>`;
    function editor(c) {
      const current = c || {
        id: 'campaign_' + newId(),
        name: '',
        name_en: '',
        intro: '',
        version: null,
      };
      $('#ownerCampaignEditor').innerHTML =
        `<form id="ownerCampaignForm" class="owner-editor"><div class="owner-fields"><label>中文名稱<input id="ownerCampaignName" required maxlength="150" value="${escape(current.name)}"></label><label>英文名稱<input id="ownerCampaignEnglish" maxlength="200" value="${escape(current.name_en)}"></label><label class="wide">戰役介紹<textarea id="ownerCampaignIntro" rows="10" maxlength="50000">${escape(current.intro)}</textarea></label></div><p class="owner-help">新增戰役會為你建立 DM 授權。已有角色的戰役不提供直接刪除。</p><button type="submit" class="owner-primary">儲存戰役</button></form>`;
      $$('#ownerCampaignForm input, #ownerCampaignForm textarea').forEach(
        (el) => (el.oninput = changed),
      );
      $('#ownerCampaignForm').onsubmit = (e) => {
        e.preventDefault();
        write(
          '/api/owner/campaign',
          {
            id: current.id,
            version: current.version,
            name: $('#ownerCampaignName').value,
            name_en: $('#ownerCampaignEnglish').value,
            intro: $('#ownerCampaignIntro').value,
          },
          '戰役已儲存。',
        );
      };
    }
    $$('[data-owner-campaign]').forEach(
      (b) =>
        (b.onclick = () => {
          if (leave()) {
            dirty = false;
            editor(model.campaigns.find((c) => c.id === b.dataset.ownerCampaign));
          }
        }),
    );
    $('#ownerNewCampaign').onclick = () => {
      if (leave()) {
        dirty = false;
        editor(null);
      }
    };
  }
  function paintAudit() {
    $('#ownerBody').innerHTML =
      `<div class="owner-section-title"><p class="owner-eyebrow">THE RECORD REMAINS</p><h2>變更紀錄</h2><p>最近 100 次管理操作。保留修改前後內容，方便核對及復原。</p></div><div class="owner-notice">典籍刪除可從「已刪除」區復原。此處是操作紀錄；完整角色、筆記及資料庫備份仍使用既有維護工具。</div><div class="owner-audit-list">${model.audit.map((a) => `<details class="owner-audit"><summary><span>${escape(actions[a.action] || a.action)}</span><strong>${escape(a.target)}</strong><time>${escape(new Date(a.created_at).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }))}</time></summary><div class="owner-diff"><section><h3>修改前</h3><pre>${escape(a.before_json ? JSON.stringify(JSON.parse(a.before_json), null, 2) : '—')}</pre></section><section><h3>修改後</h3><pre>${escape(a.after_json ? JSON.stringify(JSON.parse(a.after_json), null, 2) : '—')}</pre></section></div></details>`).join('') || '<p class="owner-empty">尚未有後台變更。</p>'}</div>`;
  }
  dialog.innerHTML = '<p class="owner-empty">正在開啟典藏管理室…</p>';
  dialog.showModal();
  dialog.oncancel = (e) => {
    if (!leave()) e.preventDefault();
  };
  try {
    await load();
    paint();
  } catch (e) {
    dialog.innerHTML = `<div class="owner-empty"><h2>無法開啟管理室</h2><p>${escape(e.message)}</p><button id="ownerErrorClose">關閉</button></div>`;
    $('#ownerErrorClose').onclick = () => dialog.close();
  }
}
