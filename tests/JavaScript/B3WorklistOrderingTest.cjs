'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

function harness(rows) {
  const nodes = {'plan-table-body': {}, 'result-summary': {}};
  const document = {addEventListener() {}, querySelector: selector => nodes[selector.slice(1)] || null};
  const sandbox = {window: {}, document, setTimeout, clearTimeout};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/cat-day/b3-state.js'), 'utf8'), sandbox);
  let response = rows;
  sandbox.window.B3Api = {allWorklist: async () => ({rows: response})};
  const source = fs.readFileSync(path.join(root, 'public/js/cat-day/cat-day-ui.js'), 'utf8');
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.worklistTest={changePlanScope,loadWorklist,go};})();'), sandbox);
  return {state: sandbox.window.B3State, api: sandbox.worklistTest, nodes, respond: rows => {response = rows;}};
}

function row(id, status, product, plan, completed = false) {
  return {work_id: id, tinh_trang: status, ten_san_pham: product, ma_ke_hoach: plan,
    completed, row_type: completed ? 'CUT_DONE' : 'FULL_CUT', chieu_dai_lay: 100};
}

test('first load sorts all rows by status, Vietnamese product name and numeric plan before pagination', async () => {
  const data = [
    row('done', 'Hoàn thành (20/20)', 'A', '1', true),
    row('waiting-10', 'Chưa thực hiện', 'A', 'KH10'),
    row('active-b', 'Đang thực hiện', 'B', '1'),
    row('active-10', 'Đang thực hiện (3/20)', 'A', '10'),
    row('waiting-2', 'Chưa thực hiện', 'a', 'KH2'),
    row('active-2', 'Đang thực hiện', 'a', '2'),
    ...Array.from({length: 7}, (_, i) => row('extra-' + i, 'Chưa thực hiện', 'Z', String(i))),
  ];
  const h = harness(data);
  await h.api.changePlanScope(null, true);
  assert.deepEqual(Array.from(h.state.worklist, r => r.work_id), [
    'active-2', 'active-10', 'active-b', 'waiting-2', 'waiting-10',
    ...Array.from({length: 7}, (_, i) => 'extra-' + i), 'done',
  ]);
  const firstPage = h.nodes['plan-table-body'].innerHTML;
  assert.equal((firstPage.match(/<tr>/g) || []).length, 10);
  assert.doesNotMatch(firstPage, /20\/20/);
  h.api.go(2);
  assert.match(h.nodes['plan-table-body'].innerHTML, /20\/20/);
  assert.equal(data[0].work_id, 'done', 'sorting does not mutate the API response');
});

test('refresh after saving reorders changed statuses and renders yellow, white and green badges', async () => {
  const data = [
    row('running', 'Đang thực hiện (3/20)', 'C', '2'),
    row('waiting', 'Chưa thực hiện', 'A', '10'),
    row('finished', 'Đã thực hiện', 'B', '1', true),
  ];
  const h = harness(data);
  await h.api.changePlanScope(null, true);
  let html = h.nodes['plan-table-body'].innerHTML;
  assert.match(html, /class="badge b3-status-badge b3-status-progress"[^>]*>Đang thực hiện \(3\/20\)<\/span>/);
  assert.match(html, /class="badge b3-status-badge b3-status-pending"[^>]*>Chưa thực hiện<\/span>/);
  assert.match(html, /class="badge b3-status-badge b3-status-done"[^>]*>Đã thực hiện<\/span>/);
  h.respond([{...data[0], completed: true, tinh_trang: 'Hoàn thành (20/20)'}, data[1], data[2]]);
  await h.api.loadWorklist();
  assert.deepEqual(Array.from(h.state.worklist, r => r.work_id), ['waiting', 'finished', 'running']);
  html = h.nodes['plan-table-body'].innerHTML;
  assert.match(html, /b3-status-done"[^>]*>Đã thực hiện \(20\/20\)<\/span>/);
  assert.equal((html.match(/<td(?:\s[^>]*)?>/g) || []).length, 27, 'nine columns remain for each row');
});

test('product collation places Vietnamese Đ before E and sorting ties retain their prior order', async () => {
  const h = harness([
    row('e', 'Chưa thực hiện', 'E', '1'), row('d1', 'Chưa thực hiện', 'Đ', '1'),
    row('d2', 'Chưa thực hiện', 'đ', '1'),
  ]);
  await h.api.changePlanScope(null, true);
  assert.deepEqual(Array.from(h.state.worklist, r => r.work_id), ['d1', 'd2', 'e']);
});
