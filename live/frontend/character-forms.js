// Shared visual controls; the Worker remains authoritative for every allocation.
function modal(title, html) {
  let d = $('#manageDialog');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'manageDialog';
    document.body.append(d);
  }
  d.innerHTML = `<form method="dialog" class="ritual-heading"><div><span class="eyebrow">ORIA’S DECREE · 冒險者典章</span><h2>${esc(title)}</h2></div><button aria-label="關閉">✕</button></form>${html}<p id="manageMessage" role="status" aria-live="polite"></p>`;
  if (!d.open) d.showModal();
  return d;
}
const signed = (n) => (Number(n) > 0 ? '+' + n : String(n));
function statSliders(kind, values, maxFor) {
  return `<div class="stat-sliders">${attributesList.map(([cn, key, en, glyph], i) => `<label class="stat-rune ability-${i}"><span>${glyph} ${cn} <small>${en}</small><output for="${kind}-${key}">${signed(values[key])}</output></span><input id="${kind}-${key}" aria-label="${cn}" data-${kind}="${key}" type="range" min="${kind === 'createattr' ? -3 : 0}" max="${maxFor(key)}" step="1" value="${values[key]}"></label>`).join('')}</div>`;
}
function wireSliders(root, update) {
  root.querySelectorAll('input[type="range"]').forEach(
    (n) =>
      (n.oninput = () => {
        n.closest('label').querySelector('output').textContent = signed(n.value);
        update();
      }),
  );
  update();
}
function candidateIds(classId, schoolId) {
  const a = ['游俠', '民俗法使', '正道使', '匠理士'],
    b = ['野戰兵', '特戰兵', '指揮官'],
    name = find('class', classId)['Class Name (Chinese)'];
  return data.spell.filter((sp) => {
    if (sp.School === schoolId) return true;
    if (sp.Exclusive) return false;
    const other = find('class', find('school', sp.School).Class)['Class Name (Chinese)'];
    return a.includes(name)
      ? a.includes(other)
      : b.includes(name)
        ? b.includes(other)
        : name === '法源技士';
  });
}
function spellPicker(root, rows, core, initial, slots) {
  const chosen = new Set(initial.filter((id) => rows.some((sp) => sp.system_id === id)));
  if (rows.some((sp) => sp.system_id === core)) chosen.add(core);
  const paint = () => {
    root.innerHTML = `<div class="row"><h3>✧ 法術契印</h3><span class="tag" aria-live="polite">已選 ${chosen.size} / ${slots}</span></div><p class="muted">點選候選法術加入右欄；點選已選法術可移回。核心法術固定佔一個名額。</p><div class="spell-ledger"><section><h4>候選法術</h4><div class="spell-choices">${
      rows
        .filter((sp) => !chosen.has(sp.system_id))
        .map((sp) => tile(sp, false))
        .join('') || '<small>已無其他候選法術</small>'
    }</div></section><section><h4>已選法術</h4><div class="spell-choices">${
      rows
        .filter((sp) => chosen.has(sp.system_id))
        .map((sp) => tile(sp, true))
        .join('') || '<small>尚未選擇</small>'
    }</div></section></div><p class="picker-error" role="status"></p>`;
    root.querySelectorAll('[data-pick]').forEach((b) => {
      paintLore(b, schoolKey(find('spell', b.dataset.pick).School));
      b.onclick = () => {
        const id = b.dataset.pick;
        if (chosen.has(id)) chosen.delete(id);
        else if (chosen.size < slots) chosen.add(id);
        else {
          root.querySelector('.picker-error').textContent = '法術名額已滿，請先移除一個已選法術。';
          return;
        }
        paint();
      };
    });
  };
  function tile(sp, selected) {
    return `<button type="button" class="spell-choice ${sp.system_id === core ? 'core-spell' : ''}" data-pick="${esc(sp.system_id)}" ${sp.system_id === core ? 'disabled' : ''} aria-label="${selected ? '移除' : '選擇'}${esc(sp['Spell Name (Chinese)'])}"><strong>${esc(sp['Spell Name (Chinese)'])}</strong><small>${sp.system_id === core ? '✦ 核心' : selected ? '← 移回候選' : '加入 →'}</small><span>${esc(sp['Action Type'] || '')} · ${esc(sp.Target || '')}</span></button>`;
  }
  paint();
  return () => [...chosen];
}
function openCharacterForm() {
  const classes = data.class.filter((c) => !c['Class Name (Chinese)'].includes('未開放'));
  const d = modal(
    '締結冒險者之名',
    `<label>角色名稱<input id="createName" maxlength="100" placeholder="寫下你的名字…"></label><div class="creation-identities"><label id="classChoice">⚔ 職業<select id="createClass">${classes.map((c) => `<option value="${esc(c.system_id)}">${esc(c['Class Name (Chinese)'])}</option>`).join('')}</select><p class="choice-description"></p></label><label id="schoolChoice">✧ 法源道<select id="createSchool"></select><p class="choice-description"></p></label><label id="backgroundChoice">⌖ 出身<select id="createBackground">${data.background.map((b) => `<option value="${esc(b.system_id)}">${esc(chineseName(b.Name))}</option>`).join('')}</select><p class="choice-description"></p></label></div><section class="allocation-section"><div class="row"><h3>六項天賦</h3><span id="creationBudget" class="tag" aria-live="polite"></span></div><p class="muted">由 −1 開始，共 14 點；降低屬性可換回點數。最低 −3，至多一項 +4，其餘最多 +3。</p>${statSliders('createattr', Object.fromEntries(attributesList.map(([, k]) => [k, -1])), () => 4)}</section><section id="createSpells"></section><label>角色故事<textarea id="createStory" rows="4" placeholder="你的旅途從何處開始…"></textarea></label><button id="createSubmit" class="ritual-submit">✦ 建立角色</button>`,
  );
  let getSpells = () => [];
  const budget = () => {
    const values = $$('[data-createattr]').map((n) => Number(n.value)),
      remaining = 14 - values.reduce((sum, n) => sum + n + 1, 0);
    $('#creationBudget').textContent = `剩餘 ${remaining} / 14 點`;
    $('#createSubmit').disabled = remaining !== 0 || values.filter((n) => n === 4).length > 1;
  };
  wireSliders(d, budget);
  const colour = () => {
    const cl = find('class', $('#createClass').value),
      sc = find('school', $('#createSchool').value),
      bg = find('background', $('#createBackground').value);
    paintLore($('#classChoice'), classKeys(cl.system_id));
    paintLore($('#schoolChoice'), schoolKey(sc.system_id));
    paintLore($('#backgroundChoice'), originKey(bg['Main Branch']));
    $('#classChoice .choice-description').textContent = cl['Short Desc'] || cl['Class Desc'] || '';
    $('#schoolChoice .choice-description').textContent = sc.Title || sc.Desc || '';
    $('#backgroundChoice .choice-description').textContent = bg['Main Branch'] || bg.Desc || '';
  };
  const spells = () => {
    const sc = find('school', $('#createSchool').value);
    getSpells = spellPicker(
      $('#createSpells'),
      candidateIds($('#createClass').value, sc.system_id),
      sc['Main Spell'],
      [],
      4,
    );
    colour();
  };
  const schools = () => {
    $('#createSchool').innerHTML = data.school
      .filter(
        (sc) =>
          sc.Class === $('#createClass').value && !sc['School Name (Chinese)'].includes('未開放'),
      )
      .map(
        (sc) => `<option value="${esc(sc.system_id)}">${esc(sc['School Name (Chinese)'])}</option>`,
      )
      .join('');
    spells();
  };
  $('#createClass').onchange = schools;
  $('#createSchool').onchange = spells;
  $('#createBackground').onchange = colour;
  schools();
  $('#createSubmit').onclick = async () => {
    const button = $('#createSubmit');
    button.disabled = true;
    try {
      const r = await api('/api/characters', {
        method: 'POST',
        body: {
          name: $('#createName').value,
          classId: $('#createClass').value,
          schoolId: $('#createSchool').value,
          backgroundId: $('#createBackground').value,
          base: Object.fromEntries(
            $$('[data-createattr]').map((n) => [n.dataset.createattr, Number(n.value)]),
          ),
          spells: getSpells(),
          story: $('#createStory').value,
        },
      });
      selected = r.id;
      await reloadLive();
      d.close();
    } catch (e) {
      $('#manageMessage').textContent = e.message;
    } finally {
      budget();
    }
  };
}
function openReselect() {
  const r = find('character', selected),
    p = perm(),
    id = selected,
    version = p.version;
  const d = modal(
    '重訂職業與法術',
    `<p>DM 已開放一次修改；提交成功後重新鎖定。</p><label>職業<select id="reClass" ${p.editClass ? '' : 'disabled'}>${data.class
      .filter((c) => !c['Class Name (Chinese)'].includes('未開放'))
      .map(
        (c) =>
          `<option value="${esc(c.system_id)}" ${c.system_id === r.Class ? 'selected' : ''}>${esc(c['Class Name (Chinese)'])}</option>`,
      )
      .join(
        '',
      )}</select></label><label>法源道<select id="reSchool" ${p.editClass ? '' : 'disabled'}></select></label><section id="reSpells"></section><button id="reSubmit" class="ritual-submit">✦ 提交並鎖定</button>`,
  );
  let getSpells;
  function spells() {
    const sc = find('school', $('#reSchool').value);
    getSpells = spellPicker(
      $('#reSpells'),
      candidateIds($('#reClass').value, sc.system_id),
      sc['Main Spell'],
      ids(r.Spells),
      Number(r['Available Spell Slots']),
    );
  }
  function schools() {
    $('#reSchool').innerHTML = data.school
      .filter(
        (sc) => sc.Class === $('#reClass').value && !sc['School Name (Chinese)'].includes('未開放'),
      )
      .map(
        (sc) =>
          `<option value="${esc(sc.system_id)}" ${sc.system_id === r.School ? 'selected' : ''}>${esc(sc['School Name (Chinese)'])}</option>`,
      )
      .join('');
    spells();
  }
  $('#reClass').onchange = schools;
  $('#reSchool').onchange = spells;
  schools();
  $('#reSubmit').onclick = async () => {
    try {
      await api(`/api/characters/${id}/reselect`, {
        method: 'POST',
        body: {
          version,
          classId: $('#reClass').value,
          schoolId: $('#reSchool').value,
          spells: getSpells(),
        },
      });
      await reloadLive();
      d.close();
    } catch (e) {
      $('#manageMessage').textContent = e.message;
    }
  };
}
function renderGrowthPanel() {
  if (page !== '角色' || tab === '背景' || !perm().owner) return;
  const r = find('character', selected),
    id = selected,
    version = perm().version,
    base = r._baseStats,
    total = Math.floor(Number(r.Level) / 2);
  const panel = document.createElement('section');
  panel.id = 'growthPanel';
  panel.className = 'allocation-section';
  panel.innerHTML = `<div class="row"><div><span class="eyebrow">ADVENTURER’S ASCENT</span><h3>✦ 成長點分配</h3></div><span class="tag">等級 ${esc(r.Level)} · 共 ${total} 點</span></div>${base ? `<p class="muted">2／4／6／8 級各獲得一點。滑桿分配成長點，每項總值最多 +5。</p>${statSliders('growth', Object.fromEntries(attributesList.map(([, k]) => [k, r._growth?.[k] || 0])), (k) => Math.min(4, 5 - Number(base[k])))}<p id="growthBudget" aria-live="polite"></p><button id="saveGrowth" class="ritual-submit">儲存成長分配</button><p id="growthMessage" role="status"></p>` : '<p class="muted">此舊角色缺少可核對的建角紀錄，暫不開放自動分配。現有屬性保留，請先與 DM 核對來源。</p>'}`;
  $('.attributes').insertAdjacentElement('afterend', panel);
  if (!base) return;
  const update = () => {
    let used = 0;
    panel.querySelectorAll('[data-growth]').forEach((n) => {
      used += Number(n.value);
      n.closest('label').querySelector('output').textContent =
        `${signed(Number(base[n.dataset.growth]) + Number(n.value))}（+${n.value}）`;
    });
    $('#growthBudget').textContent = `已用 ${used} · 剩餘 ${total - used} 點`;
    $('#saveGrowth').disabled = used > total;
  };
  wireSliders(panel, update);
  $('#saveGrowth').onclick = async () => {
    const button = $('#saveGrowth');
    button.disabled = true;
    try {
      await api(`/api/characters/${id}/growth`, {
        method: 'POST',
        body: {
          version,
          growth: Object.fromEntries(
            [...panel.querySelectorAll('[data-growth]')].map((n) => [
              n.dataset.growth,
              Number(n.value),
            ]),
          ),
        },
      });
      await reloadLive();
      saved('✓ 成長點已儲存');
    } catch (e) {
      $('#growthMessage').textContent = e.message;
      update();
    }
  };
}
function openGrowth() {
  page = '角色';
  tab = '冒險裝備';
  render();
  $('#growthPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function openAdmin() {
  const d = modal(
    'DM · 戰役典章',
    `<h3>戰役</h3>${live.campaigns.map((c) => `<div class="row"><span>${esc(c.name)} ${c.active ? '（啟用）' : ''}</span><button data-activate="${esc(c.id)}">${c.active ? '停用' : '啟用'}</button></div>`).join('')}<h3>隊伍</h3><button id="restAll">全隊長休 · 恢復意志</button><p class="muted">DM 調整等級；屬性由玩家在中央角色頁分配。成長點於 2／4／6／8 級取得。</p>${characters.map((c) => `<section class="loadout-block"><h3>${esc(c['Character Name'])}</h3><label>等級<select data-level="${esc(c.system_id)}">${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}" ${Number(c.Level) === i + 1 ? 'selected' : ''}>等級 ${i + 1} · ${Math.floor((i + 1) / 2)} 成長點</option>`).join('')}</select></label><label>已學法術名額<input data-slots="${esc(c.system_id)}" type="number" min="1" max="100" value="${esc(c['Available Spell Slots'])}"></label><label><input style="width:auto" data-editclass="${esc(c.system_id)}" type="checkbox" ${perm(c.system_id).classUnlocked ? 'checked' : ''}> 開放一次職業／法源道修改</label><label><input style="width:auto" data-editspells="${esc(c.system_id)}" type="checkbox" ${perm(c.system_id).spellsUnlocked ? 'checked' : ''}> 開放一次重選法術</label><button data-adminsave="${esc(c.system_id)}">儲存角色設定</button></section>`).join('')}`,
  );
  $$('[data-activate]').forEach(
    (b) =>
      (b.onclick = async () => {
        const c = live.campaigns.find((c) => c.id === b.dataset.activate);
        try {
          await api('/api/admin/campaign', {
            method: 'POST',
            body: { id: c.id, active: !c.active },
          });
          await reloadLive();
          d.close();
          openAdmin();
        } catch (e) {
          $('#manageMessage').textContent = e.message;
        }
      }),
  );
  $('#restAll').onclick = async () => {
    if (!confirm('恢復目前戰役所有角色的意志？生命及傷口不會重設。')) return;
    try {
      await api('/api/admin/rest', {
        method: 'POST',
        body: { campaignId: campaign.system_id, operationId: crypto.randomUUID() },
      });
      await reloadLive();
      $('#manageMessage').textContent = '全隊意志已恢復';
    } catch (e) {
      $('#manageMessage').textContent = e.message;
    }
  };
  $$('[data-adminsave]').forEach(
    (b) =>
      (b.onclick = async () => {
        const id = b.dataset.adminsave;
        b.disabled = true;
        try {
          await api('/api/admin/character', {
            method: 'PATCH',
            body: {
              id,
              version: perm(id).version,
              level: Number($(`[data-level="${id}"]`).value),
              slots: Number($(`[data-slots="${id}"]`).value),
              editClass: $(`[data-editclass="${id}"]`).checked,
              editSpells: $(`[data-editspells="${id}"]`).checked,
            },
          });
          await reloadLive();
          $('#manageMessage').textContent = '已儲存；玩家可在角色頁分配成長點';
        } catch (e) {
          $('#manageMessage').textContent = e.message;
        } finally {
          b.disabled = false;
        }
      }),
  );
}
