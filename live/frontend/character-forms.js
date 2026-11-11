// Shared visual controls; the Worker remains authoritative for every allocation.
function modal(title, html, className = '') {
  let d = $('#manageDialog');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'manageDialog';
    document.body.append(d);
  }
  d.className = className;
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
    hideSpellPreview();
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
        if (id === core) return;
        if (chosen.has(id)) chosen.delete(id);
        else if (chosen.size < slots) chosen.add(id);
        else {
          root.querySelector('.picker-error').textContent = '法術名額已滿，請先移除一個已選法術。';
          return;
        }
        paint();
      };
    });
    wireSpellPreview(root);
  };
  function tile(sp, selected) {
    return `<button type="button" class="spell-choice ${sp.system_id === core ? 'core-spell' : ''}" data-pick="${esc(sp.system_id)}" ${sp.system_id === core ? 'aria-disabled="true"' : ''} aria-pressed="${selected}" aria-label="${selected ? '移除' : '選擇'}${esc(sp['Spell Name (Chinese)'])}"><strong>${esc(sp['Spell Name (Chinese)'])}</strong><small>${sp.system_id === core ? '✦ 核心' : selected ? '← 移回候選' : '加入 →'}</small><span>${esc(sp['Action Type'] || '')} · ${esc(sp.Target || '')}</span></button>`;
  }
  paint();
  return () => [...chosen];
}
// Native radio groups provide single selection and arrow-key navigation.
function identityPicker(root, kind, rows, selectedId, onChange, disabled = false) {
  const labels = { class: ['職業', '⚔'], school: ['法源道', '✧'], background: ['出身', '⌖'] };
  const [label, glyph] = labels[kind];
  root.innerHTML = `<div class="picker-heading"><h3>${glyph} ${label}</h3><span class="tag">擇一</span></div><div class="identity-options" role="radiogroup" aria-label="${label}">${
    rows
      .map((row) => {
        const id = row.system_id,
          title =
            kind === 'class'
              ? row['Class Name (Chinese)']
              : kind === 'school'
                ? row['School Name (Chinese)']
                : chineseName(row.Name),
          subtitle =
            kind === 'class'
              ? row['Short Desc']
              : kind === 'school'
                ? row.Title
                : row['Main Branch'],
          desc = kind === 'class' ? row['Class Desc'] : row.Desc;
        return `<label class="identity-option"><input class="choice-input" type="radio" name="${root.id}" value="${esc(id)}" ${id === selectedId ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="choice-crest" aria-hidden="true">${glyph}</span><span class="choice-copy"><strong>${esc(title)}</strong><small>${esc(subtitle || '')}</small><span>${esc(desc || '從這裡開始你的旅途。')}</span></span><span class="choice-mark" aria-hidden="true">✦</span></label>`;
      })
      .join('') || '<p class="empty">目前沒有可選條目。</p>'
  }</div><div class="identity-reading prose" aria-live="polite"></div>`;
  const reading = root.querySelector('.identity-reading');
  const describe = (id) => {
    const row = rows.find((row) => row.system_id === id);
    reading.textContent = row
      ? (kind === 'class' ? row['Class Desc'] : row.Desc) ||
        (kind === 'school' ? row.Title : '') ||
        ''
      : '';
    reading.hidden = !reading.textContent;
  };
  root.querySelectorAll('.identity-option').forEach((tile) => {
    const input = tile.querySelector('input'),
      id = input.value;
    paintLore(
      tile,
      kind === 'class'
        ? classKeys(id)
        : kind === 'school'
          ? schoolKey(id)
          : originKey(find('background', id)['Main Branch']),
    );
    input.onchange = () => {
      describe(id);
      onChange(id);
    };
  });
  describe(selectedId);
}
function openCharacterForm() {
  const classes = data.class.filter((c) => !c['Class Name (Chinese)'].includes('未開放'));
  let classId = classes[0]?.system_id,
    schoolId,
    backgroundId = data.background[0]?.system_id;
  const d = modal(
    '締結冒險者之名',
    `<label>角色名稱<input id="createName" maxlength="100" placeholder="寫下你的名字…"></label><div class="creation-identities"><section id="createClass" class="identity-picker"></section><section id="createSchool" class="identity-picker"></section><section id="createBackground" class="identity-picker"></section></div><section class="allocation-section"><div class="row"><h3>六項天賦</h3><span id="creationBudget" class="tag" aria-live="polite"></span></div><p class="muted">由 −1 開始，共 14 點；降低屬性可換回點數。最低 −3，至多一項 +4，其餘最多 +3。</p>${statSliders('createattr', Object.fromEntries(attributesList.map(([, k]) => [k, -1])), () => 4)}</section><section id="createSpells"></section><label>角色故事<textarea id="createStory" rows="4" placeholder="你的旅途從何處開始…"></textarea></label><button id="createSubmit" class="ritual-submit">✦ 建立角色</button>`,
  );
  let getSpells = () => [];
  const budget = () => {
    const values = $$('[data-createattr]').map((n) => Number(n.value)),
      remaining = 14 - values.reduce((sum, n) => sum + n + 1, 0);
    $('#creationBudget').textContent = `剩餘 ${remaining} / 14 點`;
    $('#createSubmit').disabled =
      !classId ||
      !schoolId ||
      !backgroundId ||
      remaining !== 0 ||
      values.filter((n) => n === 4).length > 1;
  };
  const spells = () => {
    const sc = find('school', schoolId);
    getSpells = spellPicker(
      $('#createSpells'),
      candidateIds(classId, schoolId),
      sc['Main Spell'],
      [],
      4,
    );
    budget();
  };
  const schools = () => {
    const rows = data.school.filter(
      (sc) => sc.Class === classId && !sc['School Name (Chinese)'].includes('未開放'),
    );
    schoolId = rows[0]?.system_id;
    identityPicker($('#createSchool'), 'school', rows, schoolId, (id) => {
      schoolId = id;
      spells();
    });
    spells();
  };
  identityPicker($('#createClass'), 'class', classes, classId, (id) => {
    classId = id;
    schools();
  });
  identityPicker($('#createBackground'), 'background', data.background, backgroundId, (id) => {
    backgroundId = id;
    budget();
  });
  schools();
  wireSliders(d, budget);
  $('#createSubmit').onclick = async () => {
    $('#createSubmit').disabled = true;
    try {
      const r = await api('/api/characters', {
        method: 'POST',
        body: {
          name: $('#createName').value,
          classId,
          schoolId,
          backgroundId,
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
  let classId = r.Class,
    schoolId = r.School,
    getSpells;
  const d = modal(
    '重訂職業與法術',
    '<p>DM 已開放一次修改；提交成功後重新鎖定。</p><section id="reClass" class="identity-picker"></section><section id="reSchool" class="identity-picker"></section><section id="reSpells"></section><button id="reSubmit" class="ritual-submit">✦ 提交並鎖定</button>',
  );
  const spells = () => {
    const sc = find('school', schoolId);
    getSpells = spellPicker(
      $('#reSpells'),
      candidateIds(classId, schoolId),
      sc['Main Spell'],
      ids(r.Spells),
      Number(r['Available Spell Slots']),
    );
  };
  const schools = () => {
    const rows = data.school.filter(
      (sc) => sc.Class === classId && !sc['School Name (Chinese)'].includes('未開放'),
    );
    if (!rows.some((sc) => sc.system_id === schoolId)) schoolId = rows[0]?.system_id;
    identityPicker(
      $('#reSchool'),
      'school',
      rows,
      schoolId,
      (value) => {
        schoolId = value;
        spells();
      },
      !p.editClass,
    );
    spells();
  };
  identityPicker(
    $('#reClass'),
    'class',
    data.class.filter((c) => !c['Class Name (Chinese)'].includes('未開放')),
    classId,
    (value) => {
      classId = value;
      schools();
    },
    !p.editClass,
  );
  schools();
  $('#reSubmit').onclick = async () => {
    const button = $('#reSubmit');
    button.disabled = true;
    try {
      await api(`/api/characters/${id}/reselect`, {
        method: 'POST',
        body: { version, classId, schoolId, spells: getSpells() },
      });
      await reloadLive();
      d.close();
    } catch (e) {
      $('#manageMessage').textContent = e.message;
    } finally {
      button.disabled = false;
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
function openPrayer() {
  if (pending || !perm().edit || current().will < 1) return;
  const id = selected,
    character = find('character', id);
  const beliefs = [...new Set(ids(character.Beliefs))].map((key) => ({
    system_id: key,
    Name: key,
    ...find('beliefs', key),
  }));
  if (!beliefs.length)
    beliefs.push({
      system_id: '',
      Name: '自身意志',
      Quote: '以自身的意志，回應眼前的旅途。',
      'Belief Effect 1': '此角色尚未指定信仰；祈禱效果請依 DM 裁定。',
    });
  let operation =
    retryOperation?.id === id && retryOperation.command.kind === 'pray' ? retryOperation : null;
  let chosen = operation?.command.beliefId ?? null,
    completed = false;
  const d = modal(
    '向你的信仰祈禱',
    `<div class="prayer-introduction"><span class="ritual-star" aria-hidden="true">✺</span><p>選擇你要呼求的信仰</p><small>消耗 1 點意志 · 魅力檢定 DC 9 · 失敗亦消耗</small></div><div class="prayer-row" role="group" aria-label="選擇祈禱信仰">${beliefs.map((b) => `<button type="button" class="belief-choice prayer-card" data-prayer-belief="${esc(b.system_id)}" aria-pressed="false"><span class="prayer-card-crest">${BELIEF_KEYS[b.system_id] ? `<img src="oria/${BELIEF_KEYS[b.system_id]}.png" alt="">` : '<span aria-hidden="true">✺</span>'}</span><strong>${esc(chineseName(b.Name))}</strong><span class="belief-choice-title">${esc(b.Title || '')}</span><span class="prayer-quote">${esc(b.Quote || '以你的意志，向信仰請求力量。')}</span><span class="prayer-effect"><b>祈禱效果一</b>${esc(b['Belief Effect 1'] || '效果請依 DM 裁定。')}</span>${b['Belief Effect 2'] ? `<span class="prayer-effect"><b>祈禱效果二</b>${esc(b['Belief Effect 2'])}</span>` : ''}<span class="belief-choice-mark">選擇此信仰</span></button>`).join('')}</div><div class="prayer-actions"><span id="prayerStatus" role="status">尚未選擇信仰</span><button id="confirmPrayer" class="ritual-submit" disabled>祈禱 · 消耗 1 意志</button><button id="prayerDone" hidden>完成祈禱</button></div>`,
    'prayer-dialog',
  );
  const cards = [...d.querySelectorAll('[data-prayer-belief]')];
  const choose = (card, motion = true) => {
    chosen = card.dataset.prayerBelief;
    for (const tile of cards) {
      const active = tile === card;
      tile.setAttribute('aria-pressed', active);
      tile.querySelector('.belief-choice-mark').textContent = active ? '✓ 已選信仰' : '選擇此信仰';
    }
    $('#prayerStatus').textContent =
      '向' + chineseName(beliefs.find((b) => b.system_id === chosen).Name) + '祈禱';
    $('#confirmPrayer').disabled = false;
    if (motion) animateBeliefSelection(card, true);
  };
  cards.forEach((card, index) => {
    paintLore(card, BELIEF_KEYS[card.dataset.prayerBelief] || 'neutral');
    card.onclick = () => {
      if (!operation && !completed) choose(card);
    };
    card.onkeydown = (e) => {
      const next =
        e.key === 'ArrowRight'
          ? (index + 1) % cards.length
          : e.key === 'ArrowLeft'
            ? (index + cards.length - 1) % cards.length
            : null;
      if (next !== null) {
        e.preventDefault();
        cards[next].focus();
        cards[next].click();
      }
    };
  });
  if (operation) {
    choose(cards.find((c) => c.dataset.prayerBelief === (chosen || '')) || cards[0], false);
    cards.forEach((c) => (c.disabled = true));
    $('#confirmPrayer').textContent = '重試未確認的祈禱';
  }
  animateSurface(
    d.querySelector('.prayer-row'),
    [
      { opacity: 0, transform: 'translateY(14px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 500 },
  );
  $('#prayerDone').onclick = () => d.close();
  const prayerSubmit = $('#confirmPrayer');
  $('#confirmPrayer').onclick = async () => {
    if (completed || pending || chosen === null) return;
    if (!operation) {
      if (!perm(id).edit || stateFor(id).will < 1) return;
      operation = {
        id,
        before: structuredClone(stateFor(id)),
        operationId: crypto.randomUUID(),
        command: { kind: 'pray', ...(chosen ? { beliefId: chosen } : {}) },
      };
      stateFor(id).will--;
    }
    cards.forEach((c) => (c.disabled = true));
    $('#confirmPrayer').disabled = true;
    pending = true;
    saved('儲存中…');
    render();
    const result = await commitResource(
      id,
      operation.before,
      operation.operationId,
      operation.command,
    );
    if (!d.open || !d.contains(prayerSubmit)) return;
    if (!result) {
      $('#prayerStatus').textContent = '祈禱紀錄未確認；重試不會重複扣除意志。';
      $('#confirmPrayer').disabled = false;
      $('#confirmPrayer').textContent = '重試未確認的祈禱';
      return;
    }
    completed = true;
    const belief = beliefs.find((b) => b.system_id === chosen) || beliefs[0],
      card = cards.find((c) => c.dataset.prayerBelief === chosen) || cards[0];
    $('#prayerStatus').textContent = '祈禱已記錄，請進行魅力檢定 DC 9。';
    $('#confirmPrayer').hidden = true;
    $('#prayerDone').hidden = false;
    showDetail(
      '祈禱 · ' + chineseName(belief.Name),
      'Prayer',
      [
        belief.Quote,
        belief['Belief Effect 1'],
        belief['Belief Effect 2'],
        '魅力檢定 DC 9；失敗亦消耗意志。',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    if (!result.replayed) {
      animateBeliefSelection(card, true);
    }
    saved();
  };
}
function openAdmin() {
  const drafts = new Map(),
    resourceRetries = new Map();
  let memberId =
      characters.find((c) => c.system_id === selected)?.system_id || characters[0]?.system_id,
    busy = false,
    restOperationId = null;
  const d = modal(
    'DM · 戰役典章',
    `<details class="dm-campaign"><summary>戰役航路 · ${esc(campaign?.['Campaign Name (Chinese)'] || '目前未啟用戰役')}</summary>${live.campaigns.map((c) => `<div class="row"><span>${esc(c.name)} <small>${c.active ? '啟用中' : '未啟用'}</small></span><button data-activate="${esc(c.id)}">${c.active ? '停用' : '啟用'}</button></div>`).join('')}</details><section class="dm-rest"><div><h3>✧ 全隊長休</h3><p>補滿生命與意志、清除傷口，保留臨時生命。</p></div><button id="restAll" ${campaign && live.role === 'dm' ? '' : 'disabled'}>全隊長休</button><div id="restConfirmation" hidden><p>確認讓目前戰役的全隊成員完成長休？</p><button id="confirmRest" class="ritual-submit">確認全隊長休</button><button id="cancelRest">取消</button></div></section><nav id="dmMemberTabs" class="dm-member-tabs" role="tablist" aria-label="戰役成員"></nav><section id="dmMemberPanel" role="tabpanel"></section>`,
    'dm-dialog',
  );
  const memberPanel = d.querySelector('#dmMemberPanel'),
    message = d.querySelector('#manageMessage');
  const isCurrent = () => d.open && d.contains(memberPanel);
  function draftFor(c) {
    if (!drafts.has(c.system_id))
      drafts.set(c.system_id, {
        hp: stateFor(c.system_id).hp,
        will: stateFor(c.system_id).will,
        level: Number(c.Level),
        slots: Number(c['Available Spell Slots']),
        editClass: !!perm(c.system_id).classUnlocked,
        editSpells: !!perm(c.system_id).spellsUnlocked,
        touched: new Set(),
      });
    return drafts.get(c.system_id);
  }
  function renderTabs() {
    if (!isCurrent()) return;
    $('#dmMemberTabs').innerHTML = characters
      .map(
        (c) =>
          `<button role="tab" id="dm-tab-${esc(c.system_id)}" aria-controls="dmMemberPanel" aria-selected="${c.system_id === memberId}" tabindex="${c.system_id === memberId ? 0 : -1}" data-dm-member="${esc(c.system_id)}">${esc(c['Character Name'])}<small>生命 ${stateFor(c.system_id).hp} · 意志 ${stateFor(c.system_id).will}</small></button>`,
      )
      .join('');
    const tabs = [...d.querySelectorAll('[data-dm-member]')];
    tabs.forEach((b, i) => {
      b.disabled = busy;
      b.onclick = () => {
        memberId = b.dataset.dmMember;
        renderTabs();
        renderMember();
      };
      b.onkeydown = (e) => {
        const index =
          e.key === 'ArrowRight'
            ? (i + 1) % tabs.length
            : e.key === 'ArrowLeft'
              ? (i + tabs.length - 1) % tabs.length
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? tabs.length - 1
                  : null;
        if (index !== null) {
          e.preventDefault();
          tabs[index].click();
          d.querySelectorAll('[data-dm-member]')[index].focus();
        }
      };
    });
  }
  function renderMember() {
    if (!isCurrent()) return;
    const c = characters.find((c) => c.system_id === memberId),
      panel = $('#dmMemberPanel');
    if (!c) {
      panel.innerHTML = '<p class="empty">目前沒有戰役成員。</p>';
      return;
    }
    const id = c.system_id,
      draft = draftFor(c),
      hpMax = Number(c['Max Health']),
      willMax = Number(c['Max Willpower']),
      validCaps =
        Number.isSafeInteger(hpMax) && hpMax >= 0 && Number.isSafeInteger(willMax) && willMax >= 0;
    panel.setAttribute('aria-labelledby', 'dm-tab-' + id);
    const slider = (key, label, max, min = 0) =>
      `<label class="dm-slider dm-${key}"><span>${label}<output id="dm-${key}-value">${draft[key]} / ${max}</output></span><input aria-label="${label}" data-resource-${key}="${esc(id)}" type="range" min="${min}" max="${max}" step="1" value="${Math.max(min, Math.min(max, draft[key]))}"><small>${draft[key] > max ? '目前超過上限；手動調整時以上限為準。' : ''}</small><button type="button" data-fill-resource="${key}">回滿${label}</button></label>`;
    panel.innerHTML = `<div class="dm-member-heading"><h3>${esc(c['Character Name'])}</h3><span>${esc(find('class', c.Class)['Class Name (Chinese)'])} · ${esc(find('school', c.School)['School Name (Chinese)'])}</span><small>臨時生命 ${stateFor(id).temp} · 待結算傷口 ${stateFor(id).wounds.length}</small></div><div class="dm-editor-grid"><div class="dm-resources-pane"><div class="dm-resource-grid">${slider('hp', '生命', validCaps ? hpMax : 0, Math.min(-Math.max(1, hpMax || 0), draft.hp))}${slider('will', '意志', validCaps ? willMax : 0)}</div><button id="dmSaveResources" data-resource-save="${esc(id)}" class="ritual-submit">儲存生命／意志</button></div><section class="dm-settings"><h3>角色成長與許可</h3><label class="dm-slider"><span>等級<output id="dmLevelValue">${draft.level} · ${Math.floor(draft.level / 2)} 成長點</output></span><input type="range" min="1" max="8" step="1" aria-label="等級" data-level="${esc(id)}" value="${draft.level}"></label><p class="muted">更改等級後由玩家分配成長點；不直接改寫六項屬性。</p><label>已學法術名額<input data-slots="${esc(id)}" type="number" min="1" max="100" value="${draft.slots}"></label><label class="dm-permission"><input data-editclass="${esc(id)}" type="checkbox" ${draft.editClass ? 'checked' : ''}> 開放一次職業／法源道修改</label><label class="dm-permission"><input data-editspells="${esc(id)}" type="checkbox" ${draft.editSpells ? 'checked' : ''}> 開放一次重選法術</label><button id="dmSaveSettings" class="ritual-submit" data-adminsave="${esc(id)}">儲存角色設定</button></section></div>`;
    const editable = live.role === 'dm' && !busy;
    panel.querySelectorAll('input,button').forEach((n) => (n.disabled = !editable));
    const updateResourceButton = () => {
      $('#dmSaveResources').disabled =
        !editable || !validCaps || !['hp', 'will'].some((k) => draft.touched.has(k));
    };
    for (const key of ['hp', 'will']) {
      const input = panel.querySelector(`[data-resource-${key}]`),
        max = key === 'hp' ? hpMax : willMax;
      input.oninput = () => {
        draft[key] = Number(input.value);
        draft.touched.add(key);
        $('#dm-' + key + '-value').textContent = draft[key] + ' / ' + max;
        resourceRetries.delete(id);
        updateResourceButton();
      };
      panel.querySelector(`[data-fill-resource="${key}"]`).onclick = () => {
        draft[key] = max;
        draft.touched.add(key);
        input.value = max;
        $('#dm-' + key + '-value').textContent = max + ' / ' + max;
        resourceRetries.delete(id);
        updateResourceButton();
      };
    }
    updateResourceButton();
    panel.querySelector('[data-level]').oninput = (e) => {
      draft.level = Number(e.target.value);
      $('#dmLevelValue').textContent =
        draft.level + ' · ' + Math.floor(draft.level / 2) + ' 成長點';
    };
    panel.querySelector('[data-slots]').oninput = (e) => (draft.slots = Number(e.target.value));
    panel.querySelector('[data-editclass]').onchange = (e) => (draft.editClass = e.target.checked);
    panel.querySelector('[data-editspells]').onchange = (e) =>
      (draft.editSpells = e.target.checked);
    $('#dmSaveResources').onclick = async () => {
      const command = {
        kind: 'adjust',
        ...Object.fromEntries(
          ['hp', 'will'].filter((k) => draft.touched.has(k)).map((k) => [k, draft[k]]),
        ),
      };
      let operation = resourceRetries.get(id);
      if (!operation || JSON.stringify(operation.command) !== JSON.stringify(command)) {
        operation = { operationId: crypto.randomUUID(), command };
        resourceRetries.set(id, operation);
      }
      busy = true;
      renderTabs();
      renderMember();
      try {
        const result = await api(`/api/characters/${id}/resource`, {
          method: 'POST',
          body: operation,
        });
        state.characters[id] = result.state;
        live.permissions[id].version = result.version;
        resourceRetries.delete(id);
        draft.hp = result.state.hp;
        draft.will = result.state.will;
        draft.touched.clear();
        undo = null;
        render();
        saved();
        message.textContent = '生命與意志已儲存';
      } catch (e) {
        message.textContent = e.message + '；可重試相同調整。';
      } finally {
        busy = false;
        renderTabs();
        renderMember();
      }
    };
    $('#dmSaveSettings').onclick = async () => {
      const body = {
        id,
        version: perm(id).version,
        slots: draft.slots,
        editClass: draft.editClass,
        editSpells: draft.editSpells,
        ...(draft.level !== Number(c.Level) ? { level: draft.level } : {}),
      };
      busy = true;
      renderTabs();
      renderMember();
      try {
        await api('/api/admin/character', { method: 'PATCH', body });
        await reloadLive();
        const fresh = find('character', id);
        draft.level = Number(fresh.Level);
        draft.slots = Number(fresh['Available Spell Slots']);
        draft.editClass = !!perm(id).classUnlocked;
        draft.editSpells = !!perm(id).spellsUnlocked;
        for (const key of ['hp', 'will'])
          draft[key] = draft.touched.has(key)
            ? Math.min(draft[key], Number(fresh[key === 'hp' ? 'Max Health' : 'Max Willpower']))
            : stateFor(id)[key];
        message.textContent = '角色設定已儲存；玩家可分配成長點。';
      } catch (e) {
        message.textContent = e.message;
      } finally {
        busy = false;
        renderTabs();
        renderMember();
      }
    };
    animateSurface(
      panel,
      [
        { opacity: 0.5, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 220 },
    );
  }
  d.querySelectorAll('[data-activate]').forEach(
    (button) =>
      (button.onclick = async () => {
        if (busy) return;
        const camp = live.campaigns.find((c) => c.id === button.dataset.activate);
        button.disabled = true;
        try {
          await api('/api/admin/campaign', {
            method: 'POST',
            body: { id: camp.id, active: !camp.active },
          });
          await reloadLive();
          if (isCurrent()) {
            d.close();
            openAdmin();
          }
        } catch (e) {
          message.textContent = e.message;
          button.disabled = false;
        }
      }),
  );
  $('#restAll').onclick = () => {
    $('#restConfirmation').hidden = false;
  };
  $('#cancelRest').onclick = () => {
    $('#restConfirmation').hidden = true;
  };
  $('#confirmRest').onclick = async () => {
    if (busy) return;
    restOperationId ??= crypto.randomUUID();
    busy = true;
    $('#confirmRest').disabled = true;
    $('#cancelRest').disabled = true;
    $('#restAll').disabled = true;
    renderTabs();
    renderMember();
    try {
      await api('/api/admin/rest', {
        method: 'POST',
        body: { campaignId: campaign.system_id, operationId: restOperationId },
      });
      await reloadLive();
      drafts.clear();
      restOperationId = null;
      if (isCurrent()) $('#restConfirmation').hidden = true;
      message.textContent = '全隊生命與意志已補滿，傷口已清除。';
    } catch (e) {
      message.textContent = e.message + '；可重試同一次長休。';
    } finally {
      busy = false;
      if (isCurrent()) {
        $('#confirmRest').disabled = false;
        $('#cancelRest').disabled = false;
        $('#restAll').disabled = live.role !== 'dm';
      }
      renderTabs();
      renderMember();
    }
  };
  renderTabs();
  renderMember();
}

let spellPreviewHideTimer;
function hideSpellPreview() {
  clearTimeout(spellPreviewHideTimer);
  const preview = $('#spellPreview');
  if (preview?.matches(':popover-open')) preview.hidePopover();
}
function wireSpellPreview(root) {
  const dialog = root.closest('dialog');
  if (!dialog) return;
  let preview = dialog.querySelector('#spellPreview');
  if (!preview) {
    preview = document.createElement('aside');
    preview.id = 'spellPreview';
    preview.setAttribute('popover', 'manual');
    preview.setAttribute('role', 'tooltip');
    dialog.append(preview);
    dialog.onclose = hideSpellPreview;
    dialog.onkeydown = (e) => {
      if (e.key === 'Escape' && preview.matches(':popover-open')) {
        e.preventDefault();
        hideSpellPreview();
      }
    };
  }
  const hide = () => {
    spellPreviewHideTimer = setTimeout(hideSpellPreview, 100);
  };
  const show = (button) => {
    clearTimeout(spellPreviewHideTimer);
    const spell = find('spell', button.dataset.pick),
      school = find('school', spell.School),
      cl = find('class', school.Class);
    preview.innerHTML = `<h3>${esc(spell['Spell Name (Chinese)'])}</h3><p class="muted">${esc(cl['Class Name (Chinese)'])} · ${esc(school['School Name (Chinese)'])}</p><p>${esc(spell['Action Type'] || '')} · ${esc(spell.Target || '')}</p><div class="prose">${esc(spell['Spell Desc'] || '尚未填寫法術描述')}</div>`;
    paintLore(preview, schoolKey(spell.School));
    if (!preview.matches(':popover-open')) preview.showPopover();
    const anchor = button.getBoundingClientRect(),
      rect = preview.getBoundingClientRect();
    preview.style.left =
      Math.max(12, Math.min(innerWidth - rect.width - 12, anchor.left - rect.width - 14)) + 'px';
    preview.style.top = Math.max(12, Math.min(innerHeight - rect.height - 12, anchor.top)) + 'px';
  };
  preview.onpointerenter = () => clearTimeout(spellPreviewHideTimer);
  preview.onpointerleave = hide;
  root.querySelectorAll('[data-pick]').forEach((button) => {
    button.setAttribute('aria-describedby', 'spellPreview');
    button.onpointerenter = () => show(button);
    button.onfocus = () => show(button);
    button.onpointerleave = hide;
    button.onblur = hide;
  });
}
function openLoadout() {
  if (!perm().edit) return;
  const id = selected,
    version = perm().version,
    character = find('character', id),
    counts = new Map();
  for (const weapon of ids(character.Weapons)) counts.set(weapon, (counts.get(weapon) || 0) + 1);
  const isAvailable = (value) => ![false, 0, 'FALSE', 'false'].includes(value);
  const weapons = data.weapon.filter((w) => counts.has(w.system_id) || isAvailable(w.Available));
  for (const weapon of counts.keys())
    if (!weapons.some((w) => w.system_id === weapon))
      weapons.push({
        system_id: weapon,
        'Weapon Name': weapon,
        'Weapon Type': '既有裝備',
        Available: false,
      });
  const selectedBeliefs = new Set(ids(character.Beliefs)),
    beliefs = data.beliefs.filter((b) => selectedBeliefs.has(b.system_id) || isAvailable(b.Enable));
  for (const belief of selectedBeliefs)
    if (!beliefs.some((b) => b.system_id === belief))
      beliefs.push({ system_id: belief, Name: belief });
  const d = modal(
    '行裝與誓約',
    `<section class="weapon-picker"><div class="picker-heading"><h3>⚔ 兵器契藏</h3><span id="weaponTotal" class="tag" aria-live="polite"></span></div><p class="muted">按分類挑選武器加入行裝；同款可攜帶多把，在右欄調整數量。</p><div id="weaponTypes" class="weapon-type-tabs" role="tablist" aria-label="武器分類"></div><div class="spell-ledger weapon-ledger"><section id="weaponCandidates" role="tabpanel"><h4>可選兵器</h4><div class="spell-choices"></div></section><section><h4>攜帶行裝</h4><div id="carriedWeapons" class="spell-choices"></div></section></div></section><section class="belief-picker"><div class="picker-heading"><h3>✺ 諸神與誓約</h3><span id="beliefTotal" class="tag" aria-live="polite"></span></div><p class="muted">點選神像締結或解除信仰，可同時保留多個誓約。</p><div id="chosenBeliefs" class="chosen-beliefs" aria-live="polite"></div><div class="belief-choice-grid">${beliefs
      .map((b) => {
        const key = BELIEF_KEYS[b.system_id];
        return `<button type="button" class="belief-choice" data-loadout-belief="${esc(b.system_id)}" aria-pressed="${selectedBeliefs.has(b.system_id)}">${key ? `<img class="belief-choice-portrait" src="oria/${esc(key)}.png" alt="" loading="lazy">` : ''}<span class="belief-choice-sigil" aria-hidden="true">✺</span><strong>${esc(chineseName(b.Name))}</strong><span class="belief-choice-title">${esc(b.Title || '')}</span><span class="belief-choice-mark">${selectedBeliefs.has(b.system_id) ? '✓ 已選信仰' : '＋ 選擇信仰'}</span></button>`;
      })
      .join(
        '',
      )}</div><div id="beliefReading" class="belief-reading prose" aria-live="polite"></div></section><button id="saveLoadout" class="ritual-submit">✦ 儲存行裝與誓約</button>`,
  );
  const groups = [
    ...weaponGroups,
    ...(weapons.some((w) => weaponKind(w)[1] === 'other') ? [['其他', 'other', '◇']] : []),
  ];
  let activeType =
    groups.find(([, key]) => weapons.some((w) => weaponKind(w)[1] === key))?.[1] || 'main';
  const total = () => {
    $('#weaponTotal').textContent = `攜帶 ${[...counts.values()].reduce((n, v) => n + v, 0)} 件`;
  };
  const carried = () => {
    $('#carriedWeapons').innerHTML =
      weapons
        .filter((w) => counts.has(w.system_id))
        .map(
          (w) =>
            `<div class="carried-weapon weapon-${weaponKind(w)[1]}"><span class="weapon-glyph" aria-hidden="true">${weaponKind(w)[2]}</span><div><strong>${esc(w['Weapon Name'])}</strong><small>${esc(weaponKind(w)[0])}</small></div><label>數量<input type="number" min="0" max="1000" step="1" data-weapon-quantity="${esc(w.system_id)}" aria-label="${esc(w['Weapon Name'])}數量" value="${counts.get(w.system_id)}"></label><button type="button" data-remove-weapon="${esc(w.system_id)}" aria-label="移除${esc(w['Weapon Name'])}">✕</button></div>`,
        )
        .join('') || '<p class="empty">行裝尚無武器<br><small>由左欄加入兵器</small></p>';
    d.querySelectorAll('[data-weapon-quantity]').forEach((n) => {
      n.oninput = () => {
        const value = Number(n.value);
        if (!n.value.trim() || !Number.isSafeInteger(value) || value < 0 || value > 1000) {
          n.setAttribute('aria-invalid', 'true');
          return;
        }
        n.removeAttribute('aria-invalid');
        counts.set(n.dataset.weaponQuantity, value);
        total();
      };
      n.onchange = () => {
        if (n.value === '0') {
          counts.delete(n.dataset.weaponQuantity);
          carried();
          candidates();
        }
      };
    });
    d.querySelectorAll('[data-remove-weapon]').forEach(
      (b) =>
        (b.onclick = () => {
          counts.delete(b.dataset.removeWeapon);
          carried();
          candidates();
        }),
    );
    total();
  };
  const candidates = () => {
    const focused = document.activeElement?.dataset.addWeapon;
    $('#weaponCandidates').setAttribute('aria-labelledby', 'weapon-tab-' + activeType);
    $('#weaponCandidates .spell-choices').innerHTML =
      weapons
        .filter((w) => weaponKind(w)[1] === activeType)
        .map(
          (w) =>
            `<button type="button" class="weapon-choice weapon-${activeType}" data-add-weapon="${esc(w.system_id)}"><span class="weapon-glyph" aria-hidden="true">${weaponKind(w)[2]}</span><strong>${esc(w['Weapon Name'])}</strong><small>${counts.get(w.system_id) ? '再加一把 ＋' : '加入行裝 ＋'}</small><span>${esc([w.Damage, w.Effect].filter(Boolean).join(' · ') || '依武器說明使用')}</span></button>`,
        )
        .join('') || '<p class="empty">此分類目前沒有可選兵器。</p>';
    d.querySelectorAll('[data-add-weapon]').forEach(
      (b) =>
        (b.onclick = () => {
          const weapon = b.dataset.addWeapon,
            amount = counts.get(weapon) || 0,
            entry = weapons.find((w) => w.system_id === weapon),
            original = ids(character.Weapons).filter((w) => w === weapon).length;
          if (!isAvailable(entry.Available) && amount >= original) {
            $('#manageMessage').textContent = '此既有武器已停用，可保留、減少或移除。';
            return;
          }
          if ([...counts.values()].reduce((n, v) => n + v, 0) >= 1000) {
            $('#manageMessage').textContent = '武器總數最多 1000';
            return;
          }
          counts.set(weapon, amount + 1);
          carried();
          candidates();
        }),
    );
    d.querySelectorAll('[data-weapon-type]').forEach((b) => {
      const active = b.dataset.weaponType === activeType;
      b.setAttribute('aria-selected', active);
      b.tabIndex = active ? 0 : -1;
    });
    if (focused)
      [...d.querySelectorAll('[data-add-weapon]')]
        .find((b) => b.dataset.addWeapon === focused)
        ?.focus({ preventScroll: true });
  };
  $('#weaponTypes').innerHTML = groups
    .map(
      ([label, key, glyph]) =>
        `<button type="button" role="tab" id="weapon-tab-${key}" aria-controls="weaponCandidates" data-weapon-type="${key}">${glyph} ${label}</button>`,
    )
    .join('');
  const tabs = [...d.querySelectorAll('[data-weapon-type]')];
  tabs.forEach((b, i) => {
    b.onclick = () => {
      activeType = b.dataset.weaponType;
      candidates();
    };
    b.onkeydown = (e) => {
      const next =
        e.key === 'ArrowRight'
          ? (i + 1) % tabs.length
          : e.key === 'ArrowLeft'
            ? (i + tabs.length - 1) % tabs.length
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? tabs.length - 1
                : null;
      if (next !== null) {
        e.preventDefault();
        tabs[next].click();
        tabs[next].focus();
      }
    };
  });
  const beliefSummary = () => {
    $('#beliefTotal').textContent = `已締結 ${selectedBeliefs.size} 個誓約`;
    $('#chosenBeliefs').innerHTML =
      beliefs
        .filter((b) => selectedBeliefs.has(b.system_id))
        .map(
          (b) =>
            `<span class="chosen-belief" data-chosen-belief="${esc(b.system_id)}">✦ ${esc(chineseName(b.Name))}</span>`,
        )
        .join('') || '<span class="muted">尚未締結信仰</span>';
    d.querySelectorAll('[data-chosen-belief]').forEach((n) =>
      paintLore(n, BELIEF_KEYS[n.dataset.chosenBelief] || 'neutral'),
    );
  };
  d.querySelectorAll('[data-loadout-belief]').forEach((b) => {
    const belief = beliefs.find((row) => row.system_id === b.dataset.loadoutBelief);
    paintLore(b, BELIEF_KEYS[belief.system_id] || 'neutral');
    b.onclick = () => {
      if (selectedBeliefs.has(belief.system_id)) selectedBeliefs.delete(belief.system_id);
      else selectedBeliefs.add(belief.system_id);
      b.setAttribute('aria-pressed', selectedBeliefs.has(belief.system_id));
      b.querySelector('.belief-choice-mark').textContent = selectedBeliefs.has(belief.system_id)
        ? '✓ 已選信仰'
        : '＋ 選擇信仰';
      $('#beliefReading').textContent = [
        chineseName(belief.Name),
        belief.Desc,
        belief['Belief Effect 1'],
        belief['Belief Effect 2'],
      ]
        .filter(Boolean)
        .join('\n\n');
      paintLore($('#beliefReading'), BELIEF_KEYS[belief.system_id] || 'neutral');
      beliefSummary();
      const chip = [...d.querySelectorAll('[data-chosen-belief]')].find(
        (n) => n.dataset.chosenBelief === belief.system_id,
      );
      animateBeliefSelection(b, selectedBeliefs.has(belief.system_id), chip);
    };
  });
  carried();
  candidates();
  beliefSummary();
  animateSurface(
    d.querySelector('.belief-choice-grid'),
    [
      { opacity: 0.4, transform: 'translateY(10px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 400 },
  );
  const button = $('#saveLoadout');
  button.onclick = async () => {
    const inputs = [...d.querySelectorAll('[data-weapon-quantity]')];
    if (inputs.some((n) => !n.value.trim() || n.getAttribute('aria-invalid') === 'true')) {
      $('#manageMessage').textContent = '請填寫有效的武器數量；0 代表移除';
      return;
    }
    const quantities = [...counts]
      .filter(([, quantity]) => quantity > 0)
      .map(([id, quantity]) => ({ id, quantity }));
    if (quantities.reduce((n, w) => n + w.quantity, 0) > 1000) {
      $('#manageMessage').textContent = '武器總數最多 1000';
      return;
    }
    button.disabled = true;
    try {
      await api(`/api/characters/${id}/loadout`, {
        method: 'PATCH',
        body: { version, weapons: quantities, beliefs: [...selectedBeliefs] },
      });
      undo = null;
      await reloadLive();
      d.close();
      saved();
      toast('武器與信仰已更新');
    } catch (e) {
      $('#manageMessage').textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };
}
