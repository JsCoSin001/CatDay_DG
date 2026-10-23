'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

test('worklist displays nine columns, a plain product name and the length of each cut', () => {
  const nodes = {'plan-table-body': {}, 'result-summary': {}};
  const document = {addEventListener() {}, querySelector: selector => nodes[selector.slice(1)] || null};
  const state = {page: 1, worklist: [400, 70, 100, 150].map((length, index) => ({
    ma_ke_hoach: 'KH001', ten_san_pham: 'Dây điện A & B', standard_length: 400,
    tinh_trang: index === 0 ? 'Chưa thực hiện (0/20)' : 'Chưa thực hiện',
    chieu_dai_lay: length, so_luong_cuon: index === 0 ? 20 : null,
    so_cuon_cat_le: index === 0 ? null : 1,
    so_dau: null, so_cuoi: null, lot: 'LOT-' + index,
  }))};
  const context = {window: {B3State: state, B3Api: {}}, document, setTimeout, clearTimeout};
  const source = fs.readFileSync(path.join(root, 'public/js/cat-day/cat-day-ui.js'), 'utf8');
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.renderTable = renderTable;})();'), context);
  context.renderTable();
  const rows = [...nodes['plan-table-body'].innerHTML.matchAll(/<tr>(.*?)<\/tr>/g)]
    .map(match => [...match[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(cell => cell[1]));
  assert.equal(rows.length, 4);
  rows.forEach((row, index) => {
    assert.equal(row.length, 9);
    assert.equal(row[1], 'Dây điện A &amp; B');
    assert.equal(row[2], 'LOT-' + index);
    assert.equal(row[4], String([400, 70, 100, 150][index]));
    assert.equal(row[5], index === 0 ? '20' : '');
    assert.equal(row[6], index === 0 ? '' : '1');
    assert.deepEqual(row.slice(7), ['', '']);
  });
  const blade = fs.readFileSync(path.join(root, 'resources/views/welcome.blade.php'), 'utf8');
  const headers = [...blade.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g)].map(match => match[1]);
  assert.deepEqual(headers, ['Mã kế hoạch', 'Tên sản phẩm', 'LOT', 'Tình trạng', 'Chiều dài lấy',
    'Số lượng cuộn', 'Số cuộn cắt lẻ', 'Số đầu', 'Số cuối']);
});
