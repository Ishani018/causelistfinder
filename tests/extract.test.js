// Finding case numbers in an uploaded case list (made-up numbers).
const test = require('node:test');
const assert = require('node:assert');
const { extractCases } = require('../src/parser.js');

test('finds case numbers written in the usual ways', () => {
  const text = [
    'Sl. No. | Case No. | Parties | Next date',
    '1 | WPA 1234 of 2025 | A vs State of West Bengal | 12.11.2026',
    '2 | W.P.A. No. 77/2026 | B vs C',
    '3 | FMAT/506/2026 | D vs E',
    'MAT/999/2026, CAN No. 1 of 2026',
    'WP 3710(W)/2020',
    'AO-COM/3/2026 and CRA (DB) 45 of 2024',
    'WPA | 4321 | 2026',
    'wpa 55/2026 (duplicate below)', 'WPA/55/2026',
    'CAN 7 of 2026',
    'Dated 05/11/2026, Page 12 2026, Court No. 7 2026, Room 5/2026, PS Case No 123/2024, Rs. 5000/2026',
  ].join('\n');
  assert.deepStrictEqual(extractCases(text), ['WPA/1234/2025', 'WPA/77/2026', 'FMAT/506/2026', 'MAT/999/2026', 'WPA/3710/2020', 'AO-COM/3/2026', 'CRA(DB)/45/2024',
    'WPA/4321/2026', 'WPA/55/2026', 'CAN/7/2026']);
});
