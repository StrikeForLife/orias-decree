/** Replace offline adapters by named boundaries, independent of source formatting. */
export function replaceRegion(source, name, replacement) {
  const start = `// @${name}:start`;
  const end = `// @${name}:end`;
  const begin = source.indexOf(start);
  const finish = source.indexOf(end);
  if (
    begin < 0 ||
    finish < begin ||
    source.indexOf(start, begin + start.length) >= 0 ||
    source.indexOf(end, finish + end.length) >= 0
  ) {
    throw Error(`Missing, duplicated or reversed frontend region: ${name}`);
  }
  const suffix = source.slice(finish + end.length).replace(/^\r?\n/, '');
  return source.slice(0, begin) + replacement.trimEnd() + '\n' + suffix;
}

export function buildApp(source, { state, notes, forms, motion }) {
  let app = replaceRegion(source, 'live-state', state);
  app = replaceRegion(app, 'live-notes', notes);
  return `${app}\n${forms}\n${motion}\n
const originalRender = render;
render = function () {
  originalRender();
  protectUI();
  renderGrowthPanel();
};
protectUI();
renderGrowthPanel();
`;
}

function replaceOnce(source, from, to) {
  if (!source.includes(from) || source.indexOf(from) !== source.lastIndexOf(from)) {
    throw Error(`Expected exactly one frontend HTML anchor: ${from}`);
  }
  return source.replace(from, to);
}

export function buildHTML(source) {
  let html = replaceOnce(
    source,
    '私人試玩版 · 現有角色資料快照 · 修改只儲存在此瀏覽器，未連接 Google 登入或回寫 Sheets',
    '正式版連線狀態：等待 Google 登入',
  );
  html = replaceOnce(html, 'src="app.js"', 'src="boot.js"');
  // The main content is hidden until the protected bootstrap succeeds.
  html = replaceOnce(
    html,
    '<main>',
    '<section id="loginPanel" class="login-panel"><div class="eyebrow">ORIA’S DECREE</div><h1>以 Google 帳號進入戰役</h1><p id="loginMessage">正在檢查登入狀態…</p><div id="googleButton"></div></section><main hidden>',
  );
  return replaceOnce(
    html,
    '</head>',
    '<link rel="stylesheet" href="live.css"><link rel="stylesheet" href="owner-console.css"></head>',
  );
}
