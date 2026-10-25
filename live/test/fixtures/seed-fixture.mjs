/** Synthetic import data; no real player identities or private character notes. */
export function seedFixture() {
  const source = {
    campaign: [
      {
        system_id: 'camp-one',
        'Campaign Name (Chinese)': '測試戰役',
        'Campaign Name (English)': 'Test',
        Status: 'TRUE',
      },
      {
        system_id: 'camp-two',
        'Campaign Name (Chinese)': '舊測試戰役',
        'Campaign Name (English)': 'Old test',
        Status: 'FALSE',
      },
    ],
    character: [],
    class: [],
    school: [],
    spell: [],
    weapon: [],
    beliefs: [],
  };
  const owners = [];
  for (let i = 0; i < 10; i++) {
    const id = 'test-character-' + i;
    source.character.push({
      system_id: id,
      Campaign: 'camp-one',
      'Character Name': '測試角色 ' + i,
      'Current Health': '15',
      'Current Willpower': '1',
      Notes: 'Synthetic note',
      Inventory: 'Synthetic item',
    });
    owners.push({ id, email: 'player@example.invalid' });
  }
  return {
    source,
    background: [],
    mapping: {
      owners,
      users: [{ email: 'player@example.invalid', status: 'Active', player: true, dm: false }],
    },
  };
}
