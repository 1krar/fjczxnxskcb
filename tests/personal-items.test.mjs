import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const memory = new Map();
let failWrite = false;
globalThis.localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => { if (failWrite) throw new Error('quota'); memory.set(key, value); },
};
globalThis.window = new EventTarget();
const source = await readFile(new URL('../js/tasks-store.js', import.meta.url), 'utf8');
const store = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const fields = {
  semester: '2026-2027-1', className: '三班', courseName: '英语',
  text: '下周交演讲稿\n具体时间再确认 <img src=x onerror=alert(1)>',
  kind: 'task', source: 'oral', dueDate: '', dueTime: '', needsConfirmation: true, nextStep: '',
};
assert.deepEqual(store.readItems(), []);
const first = store.saveItem(fields);
assert.equal(store.readItems()[0].text, fields.text);
assert.equal(store.readItems()[0].dueDate, '');
assert.equal(store.itemsForScope({ semester: fields.semester, className: '别班' }).length, 0);
assert.equal(store.escapeText('<script>"&'), '&lt;script&gt;&quot;&amp;');
store.updateItemState(first.id, 'complete');
assert.ok(store.readItems()[0].completedAt);
store.updateItemState(first.id, 'reopen');
assert.equal(store.readItems()[0].completedAt, '');
const edited = store.saveItem({ ...fields, dueDate: '2026-10-23', dueTime: '18:30', needsConfirmation: false }, first.id);
assert.equal(edited.id, first.id);
assert.equal(edited.createdAt, first.createdAt);
assert.equal(edited.windowStart,'','old records remain readable without period metadata');
const ranged=store.saveItem({...edited,windowStart:'15:00',windowEnd:'16:00'},edited.id);
assert.match(store.dateLabel(ranged,'2026-10-23'),/15:00—16:00/);
assert.equal(store.readItems()[0].windowEnd,'16:00');
const rangedBackup=store.validateBackup({schemaVersion:1,items:[ranged]});
assert.equal(rangedBackup.items[0].windowStart,'15:00','structured periods survive backup validation');
assert.throws(()=>store.saveItem({...ranged,windowEnd:'14:00'},ranged.id));
assert.equal(store.readItems().length, 1);
assert.equal(store.isOverdue(edited, '2026-10-24'), true);
assert.equal(store.isOverdue(edited, '2026-10-23', new Date('2026-10-23T18:00:00')), false);
assert.equal(store.isOverdue(edited, '2026-10-23', new Date('2026-10-23T19:00:00')), true);
const beforeInvalid = JSON.stringify(store.readItems());
for (const bad of [{ dueDate: '2026-02-30' }, { dueTime: '25:10' }, { text: '  ' }, { kind: '__proto__' }]) {
  assert.throws(() => store.saveItem({ ...fields, ...bad }, first.id));
  assert.equal(JSON.stringify(store.readItems()), beforeInvalid);
}
store.updateItemState(first.id, 'trash');
assert.ok(store.readItems()[0].deletedAt);
store.updateItemState(first.id, 'restore');
assert.equal(store.readItems()[0].deletedAt, '');
const old = { ...first, updatedAt: '2020-01-01T00:00:00.000Z' };
assert.deepEqual(store.mergeBackup({ schemaVersion: 1, items: [old] }), { added: 0, updated: 0 });
assert.equal(store.readItems()[0].dueDate, edited.dueDate);
const another = { ...first, id: 'other-device', text: 'QQ群通知', updatedAt: '2030-01-01T00:00:00.000Z' };
assert.deepEqual(store.mergeBackup({ schemaVersion: 1, items: [another] }), { added: 1, updated: 0 });
assert.deepEqual(store.mergeBackup({ schemaVersion: 1, items: [another] }), { added: 0, updated: 0 });
assert.equal(store.readItems().length, 2);
const undated=store.saveItem({...fields,text:'下午说明会',kind:'note',dueTime:'15:40',windowStart:'15:40',needsConfirmation:false});
assert.equal(store.readItems().find(row=>row.id===undated.id).dueTime,'15:40');
assert.match(store.dateLabel(undated,'2026-10-21'),/15:40/);
assert.equal(store.isOverdue(undated,'2026-10-24'),false,'an undated clock must never become overdue');
assert.equal(store.validateBackup({schemaVersion:1,items:[undated]}).items[0].dueDate,'');
assert.throws(() => store.validateBackup({ schemaVersion: 1, items: [another, another] }));
const beforeFailure = [...memory.values()][0];
failWrite = true;
assert.throws(() => store.saveItem(fields), /保存失败/);
assert.equal([...memory.values()][0], beforeFailure);
failWrite = false;
const key = [...memory.keys()][0];
memory.set(key, '{damaged');
assert.throws(() => store.readItems(), /原数据已保留/);
assert.throws(() => store.saveItem(fields));
assert.equal(memory.get(key), '{damaged');
console.log('个人事项：记录、作用域、日期、完成与恢复、备份合并、异常保留和文本安全检查通过。');
