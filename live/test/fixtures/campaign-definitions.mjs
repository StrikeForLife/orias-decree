/** Synthetic rule definitions shared by API and visual regression checks. */
export function addCampaignDefinitions(db) {
  for (const [kind, id, payload] of [
    ['class', 'ranger', { 'Class Name (Chinese)': '游俠' }],
    [
      'school',
      'wind',
      { 'School Name (Chinese)': '風道', Class: 'ranger', Belief: 'faith', 'Main Spell': 'core' },
    ],
    [
      'spell',
      'core',
      { 'Spell Name (Chinese)': '核心法術', School: 'wind', 'Spell Desc': '核心法術描述。' },
    ],
    [
      'spell',
      'option',
      {
        'Spell Name (Chinese)': '流風發散',
        School: 'wind',
        'Action Type': '動作',
        Target: '一個目標',
        'Spell Desc': '第一段法術說明。\n\n第二段完整說明。',
      },
    ],
    ['background', 'origin', { Name: '測試出身' }],
    [
      'weapon',
      'blade',
      {
        'Weapon Name': '佩刀',
        'Weapon Type': '主武器 Main Weapon',
        Available: 'TRUE',
        Damage: '1d8',
        Effect: '佩刀效果',
      },
    ],
    [
      'weapon',
      'shield',
      { 'Weapon Name': '盾牌', 'Weapon Type': '非武器 Non-weapon', Available: true },
    ],
    ['weapon', 'locked', { 'Weapon Name': '停用武器', Available: false }],
    ['beliefs', 'faith', { Name: '自由', Title: '無常之翼', Enable: 'TRUE' }],
    ['beliefs', 'other-faith', { Name: '智慧', Title: '知識之光', Enable: true }],
    ['beliefs', 'locked-faith', { Name: '停用信仰', Enable: 'FALSE' }],
  ])
    db.raw
      .prepare('INSERT INTO definitions(kind,id,payload) VALUES(?,?,?)')
      .run(kind, id, JSON.stringify({ system_id: id, ...payload }));
}
