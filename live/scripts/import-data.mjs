import fs from 'node:fs/promises';
/** Read-only source snapshot import; never writes back to Google Sheets. */
export async function seed(db, input) {
  const source =
      input?.source ||
      JSON.parse(await fs.readFile(new URL('../../dist/data.json', import.meta.url))),
    background =
      input?.background ||
      JSON.parse(await fs.readFile(new URL('../../dist/background.json', import.meta.url))),
    mapping =
      input?.mapping ||
      JSON.parse(await fs.readFile(new URL('../import-mapping.json', import.meta.url)));
  if (await db.prepare('SELECT id FROM campaigns LIMIT 1').first())
    throw Error('Database is not empty; refusing to overwrite live records');
  const q = (sql, ...args) => db.prepare(sql).bind(...args),
    statements = [];
  source.background = background;
  for (const c of source.campaign)
    statements.push(
      q(
        'INSERT INTO campaigns(id,name,name_en,intro,active) VALUES(?,?,?,?,?)',
        c.system_id,
        c['Campaign Name (Chinese)'],
        c['Campaign Name (English)'],
        c.Intro || '',
        c.Status === 'TRUE' ? 1 : 0,
      ),
    );
  for (const kind of ['class', 'school', 'spell', 'weapon', 'beliefs', 'background'])
    for (const d of source[kind])
      statements.push(
        q(
          'INSERT INTO definitions(kind,id,payload) VALUES(?,?,?)',
          kind,
          d.system_id,
          JSON.stringify(d),
        ),
      );
  for (const u of mapping.users.filter((x) => x.status === 'Active' && (x.dm || x.player)))
    for (const c of source.campaign)
      statements.push(
        q(
          'INSERT INTO access_grants(id,email,campaign_id,role) VALUES(?,?,?,?)',
          crypto.randomUUID(),
          u.email.toLowerCase(),
          c.system_id,
          u.dm ? 'dm' : 'player',
        ),
      );
  for (const c of source.character) {
    const owner = mapping.owners.find((o) => o.id === c.system_id)?.email?.toLowerCase();
    if (!owner) throw Error('Missing source ownership mapping: ' + c.system_id);
    const sh = { ...c };
    delete sh.Inventory;
    delete sh.Notes;
    delete sh['Current Health'];
    delete sh['Current Willpower'];
    const state = {
      hp: Number(c['Current Health']),
      temp: 0,
      will: Number(c['Current Willpower']),
      wounds: [],
      general: c.Notes || '',
      inventory: c.Inventory || '',
    };
    statements.push(
      q(
        'INSERT INTO characters(id,campaign_id,owner_email,sheet,state) VALUES(?,?,?,?,?)',
        c.system_id,
        c.Campaign,
        owner,
        JSON.stringify(sh),
        JSON.stringify(state),
      ),
    );
    for (const [column, table, field] of [
      ['Spells', 'character_spells', 'spell_id'],
      ['Weapons', 'character_weapons', 'weapon_id'],
    ])
      for (const id of String(c[column] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean))
        statements.push(
          q(`INSERT INTO ${table}(character_id,${field}) VALUES(?,?)`, c.system_id, id),
        );
  }
  await db.batch(statements);
  return {
    characters: source.character.length,
    campaigns: source.campaign.length,
    notesImported: 'General notes only; session-note table needs a separate audited import',
    ownership: 'created_by mappings require DM review before inviting players',
  };
}
