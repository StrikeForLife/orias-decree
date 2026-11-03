import { sqliteDB } from '../../scripts/sqlite-adapter.mjs';
import { legacySchema } from '../../scripts/rehearse-normalization.mjs';

/** Entirely synthetic; suitable for isolated local D1 rehearsals. */
export function normalizationFixture() {
  const db = sqliteDB();
  db.raw.exec(legacySchema);
  db.raw.exec(`INSERT INTO campaigns(id,name,active) VALUES('camp','Active',1),('old','Inactive',0);
  INSERT INTO users(id,google_sub,email) VALUES('owner','owner','owner@example.invalid'),('dm','dm','dm@example.invalid'),('other','other','other@example.invalid'),('reader','reader','reader@example.invalid');
  INSERT INTO access_grants(id,email,user_id,campaign_id,role) VALUES('g1','owner@example.invalid','owner','camp','player'),('g2','dm@example.invalid','dm','camp','dm'),('g3','other@example.invalid','other','camp','player');
  INSERT INTO site_owner VALUES(1,'owner',1);`);
  const defs = [
    [
      'class',
      'ranger',
      {
        'Class Name (Chinese)': '游俠',
        'Class Name (English)': 'Ranger',
        'Short Desc': 'Position',
        Faction: 'A',
        Speed: '10',
        'Class Desc': 'Detail',
        ...Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [`Level ${i + 1} Perk`, 'perk' + i]),
        ),
      },
    ],
    [
      'school',
      'wind',
      {
        'School Name (Chinese)': '風道',
        Class: 'ranger',
        Belief: 'faith',
        'Main Spell': 'core',
        Title: 'Title',
        Passive: 'Passive',
        Desc: 'Detail',
      },
    ],
    [
      'spell',
      'core',
      {
        'Spell Name (Chinese)': '核心',
        School: 'wind',
        'Action Type': 'Action',
        Target: 'Target',
        Exclusive: false,
        'Spell Desc': 'Desc',
      },
    ],
    [
      'weapon',
      'blade',
      {
        'Weapon Name': 'Blade',
        'Weapon Type': 'Melee',
        Damage: '1d4',
        Effect: 'Effect',
        'Reveal Effect': true,
        Available: 'TRUE',
      },
    ],
    [
      'beliefs',
      'faith',
      {
        Name: 'Faith',
        Title: 'Title',
        Quote: 'Quote',
        Desc: 'Desc',
        Enable: true,
        'Belief Effect 1': 'One',
        'Belief Effect 2': 'Two',
      },
    ],
    [
      'background',
      'origin',
      {
        Name: 'Origin',
        'Main Branch': 'Branch',
        Personality: 'Personality',
        Desc: 'Desc',
        'Skill 1': 'First',
        'Skill 2': 'Second',
      },
    ],
  ];
  for (const [kind, id, p] of defs)
    db.raw
      .prepare('INSERT INTO definitions(kind,id,payload) VALUES(?,?,?)')
      .run(kind, id, JSON.stringify({ system_id: id, ...p }));
  db.raw
    .prepare('INSERT INTO definitions(kind,id,payload,archived,version) VALUES(?,?,?,?,?)')
    .run(
      'weapon',
      'archived',
      JSON.stringify({ system_id: 'archived', 'Weapon Name': 'Archived' }),
      1,
      7,
    );
  const sheet = {
    system_id: 'hero',
    Campaign: 'camp',
    'Character Name': 'Hero',
    Level: '3',
    Class: 'ranger',
    School: 'wind',
    Background: 'origin',
    Beliefs: 'faith , faith, missing-faith',
    'Background Story': 'Story',
    Strength: '-2',
    Dexterity: '4',
    Constitution: '0',
    Intelligence: '1',
    Wisdom: '-1',
    Charisma: '2',
    'Max Health': '123',
    'Max Willpower': '42',
    'Armor Class': '99',
    'Spell Difficulty': '88',
    'Available Spell Slots': '17',
    _baseStats: {
      Strength: -2,
      Dexterity: 3,
      Constitution: 0,
      Intelligence: 1,
      Wisdom: -1,
      Charisma: 2,
      unknownAllocation: { keep: true },
    },
    _growth: {
      Strength: 0,
      Dexterity: 1,
      Constitution: 0,
      Intelligence: 0,
      Wisdom: 0,
      Charisma: 0,
    },
    unknown: { nested: [false, null, 3] },
    'odd."key': null,
  };
  const state = {
    hp: -7,
    temp: 9,
    will: 2,
    wounds: [2, 2, 1],
    general: 'PRIVATE NOTE',
    inventory: 'rope\ncoins × 3\nanything goes',
    future: { a: [1, null, true] },
  };
  for (const [id, camp] of [
    ['hero', 'camp'],
    ['inactive', 'old'],
  ])
    db.raw
      .prepare(
        'INSERT INTO characters(id,campaign_id,owner_email,owner_user_id,sheet,state,version,edit_class,edit_spells) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        camp,
        'owner@example.invalid',
        'owner',
        JSON.stringify({ ...sheet, system_id: id, Campaign: camp }),
        JSON.stringify(state),
        13,
        1,
        1,
      );
  db.raw
    .exec(`INSERT INTO character_spells VALUES('hero','core'),('hero','missing-spell'); INSERT INTO character_weapons VALUES('hero','blade');
  INSERT INTO session_notes VALUES('note','hero','owner','Title','2026-11-03','Private body',5,0);
  INSERT INTO sessions VALUES('existing-token-hash','owner','existing-csrf',9999999999999);
  INSERT INTO operations VALUES('prior-op','owner','hero','{"kind":"pray"}','{"hp":-8,"temp":9,"will":3,"wounds":[2,2,1]}','{"hp":-7,"temp":9,"will":2,"wounds":[2,2,1]}',13,1,NULL);
  INSERT INTO owner_audit VALUES('audit','owner','content.update','spell:core','{}','{}',1);
  CREATE TRIGGER imported_claim AFTER UPDATE OF owner_user_id ON characters BEGIN SELECT 1; END;`);
  return db;
}
