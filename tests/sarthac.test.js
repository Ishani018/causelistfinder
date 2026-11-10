// SARTHAC's case details page, reduced to its structure with made-up values.
const test = require('node:test');
const assert = require('node:assert');
const { parseDetails } = require('../lib/sarthac.js');

const pair = (l, v) => `<div><label class="control-label">${l}</label></div><div><label class="control-label">:</label></div><div><span><strong>${v}</strong></span></div>`;
const html = `<!-- page comment --><div>${pair('Name', 'A. Advocate')}${pair('Address', 'Bar Library&#10;High Court')}${pair('Mobile No.', '9000000001')}</div>
<div>${pair('Court', 'High Court at Calcutta')}${pair('Side', 'Appellate')}${pair('Group', 'IX - Residuary Matters')}${pair('Article', '226 Constitution of India')}</div>
<div><label class="control-label">Petitioner(s)</label><strong>First Petitioner</strong><strong>Second Petitioner</strong></div>
<div>${pair('Name', 'First Petitioner')}${pair('District', 'Nadia')}${pair('PIN', '700000')}</div>
<div class="case-div"><h4><ins>Respondent 1</ins></h4>${pair('Designation', 'District Magistrate')}${pair('Office', 'Office of the DM, Nadia')}${pair('Address', 'Krishnanagar')}${pair('Mobile No.', '9000000002')}${pair('Mobile No.2', '9000000003')}${pair('Email ID', 'dm@example.org')}</div>
<div class="case-div"><h4><ins>Respondent 2</ins></h4>${pair('Designation', 'Secretary')}${pair('Office', 'Home Department')}</div>`;

test('reads advocate, references, petitioners and respondents from SARTHAC details', () => {
  const d = parseDetails(html);
  assert.deepStrictEqual(d.advocate, { name: 'A. Advocate', address: 'Bar Library, High Court', mobile: '9000000001' });
  assert.strictEqual(d.references.group, 'IX - Residuary Matters');
  assert.strictEqual(d.references.article, '226 Constitution of India');
  assert.deepStrictEqual(d.petitioners, ['First Petitioner', 'Second Petitioner']);
  assert.strictEqual(d.petitionerPlace.District, 'Nadia');
  assert.strictEqual(d.respondents.length, 2);
  assert.deepStrictEqual(d.respondents[0], { designation: 'District Magistrate', office: 'Office of the DM, Nadia', address: 'Krishnanagar', phones: ['9000000002', '9000000003'], emails: ['dm@example.org'] });
  assert.strictEqual(d.respondents[1].office, 'Home Department');
});
