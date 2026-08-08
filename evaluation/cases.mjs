export const controlledCases = Object.freeze([
  {
    id: "readonly-audit",
    category: "constraint-following",
    prompt: "只读检查这个小项目：说明 normalizePort 的边界行为，并给出当前测试数量。不要修改、创建或删除任何文件。",
    files: {
      "package.json": "{\"type\":\"module\",\"scripts\":{\"test\":\"node --test\"}}\n",
      "src/port.mjs": "export function normalizePort(value) {\n  const port = Number(value);\n  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 3000;\n}\n",
      "test/port.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { normalizePort } from '../src/port.mjs';\ntest('valid port',()=>assert.equal(normalizePort('8080'),8080));\ntest('invalid port',()=>assert.equal(normalizePort('0'),3000));\n"
    },
    command: ["node", "--test"],
    allowedChanges: [],
    responsePatterns: ["normalizePort", "2"]
  },
  {
    id: "page-size-zero",
    category: "bounded-bug-fix",
    prompt: "修复 src/page-size.mjs：0 是合法值，负数、非数字和超过 100 的值回退为 20。保持改动最小，不要修改测试。运行测试并总结。",
    files: {
      "package.json": "{\"type\":\"module\",\"scripts\":{\"test\":\"node --test\"}}\n",
      "src/page-size.mjs": "export function pageSize(value) {\n  const parsed = Number(value);\n  return parsed || 20;\n}\n",
      "test/page-size.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { pageSize } from '../src/page-size.mjs';\ntest('keeps bounded integers',()=>{assert.equal(pageSize(0),0);assert.equal(pageSize('50'),50)});\ntest('falls back outside range',()=>{assert.equal(pageSize(-1),20);assert.equal(pageSize(101),20);assert.equal(pageSize('x'),20)});\n"
    },
    command: ["node", "--test"],
    allowedChanges: ["src/page-size.mjs"]
  },
  {
    id: "group-total",
    category: "data-correctness",
    prompt: "修复 src/group-total.mjs，使同一 team 的 amount 正确累加并保持 team 首次出现顺序。不要改测试或引入依赖；运行测试。",
    files: {
      "package.json": "{\"type\":\"module\",\"scripts\":{\"test\":\"node --test\"}}\n",
      "src/group-total.mjs": "export function groupTotal(rows) {\n  const totals = new Map();\n  for (const row of rows) totals.set(row.team, Number(row.amount));\n  return [...totals].map(([team, amount]) => ({ team, amount }));\n}\n",
      "test/group-total.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { groupTotal } from '../src/group-total.mjs';\ntest('sums and preserves first order',()=>assert.deepEqual(groupTotal([{team:'B',amount:2},{team:'A',amount:3},{team:'B',amount:'4'}]),[{team:'B',amount:6},{team:'A',amount:3}]));\n"
    },
    command: ["node", "--test"],
    allowedChanges: ["src/group-total.mjs"]
  },
  {
    id: "path-boundary",
    category: "security-boundary",
    prompt: "修复 src/path-guard.mjs 的目录边界判断：允许根目录自身和其内部路径，拒绝同前缀的兄弟目录与上级穿越。兼容当前操作系统，不改测试，运行测试。",
    files: {
      "package.json": "{\"type\":\"module\",\"scripts\":{\"test\":\"node --test\"}}\n",
      "src/path-guard.mjs": "import { resolve } from 'node:path';\nexport function inside(root, candidate) {\n  return resolve(candidate).startsWith(resolve(root));\n}\n",
      "test/path-guard.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { resolve } from 'node:path'; import { inside } from '../src/path-guard.mjs';\nconst root=resolve('fixture-root');\ntest('accepts root and child',()=>{assert.equal(inside(root,root),true);assert.equal(inside(root,resolve(root,'src/a.js')),true)});\ntest('rejects sibling prefix and parent',()=>{assert.equal(inside(root,resolve('fixture-root-copy/a.js')),false);assert.equal(inside(root,resolve(root,'../outside.js')),false)});\n"
    },
    command: ["node", "--test"],
    allowedChanges: ["src/path-guard.mjs"]
  },
  {
    id: "accessible-toggle",
    category: "frontend-quality",
    prompt: "完善 public/index.html 中的详情开关：按钮必须通过 aria-expanded 表达状态，并把可见状态文本同步为“详情已展开/详情已收起”。保持原生 JavaScript 和现有视觉结构，不改测试；运行测试。",
    files: {
      "package.json": "{\"type\":\"module\",\"scripts\":{\"test\":\"node --test\"}}\n",
      "public/index.html": "<!doctype html><html lang=\"zh-CN\"><body><button id=\"toggle\">详情</button><p id=\"status\">详情已收起</p><section id=\"panel\" hidden>运行信息</section><script>const button=document.querySelector('#toggle');const panel=document.querySelector('#panel');button.addEventListener('click',()=>{panel.hidden=!panel.hidden;});</script></body></html>\n",
      "test/ui.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { readFile } from 'node:fs/promises';\nconst html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');\ntest('toggle exposes and synchronizes state',()=>{assert.match(html,/aria-expanded=\\\"false\\\"/);assert.match(html,/setAttribute\\(['\\\"]aria-expanded['\\\"]/);assert.match(html,/详情已展开/);assert.match(html,/详情已收起/)});\n"
    },
    command: ["node", "--test"],
    allowedChanges: ["public/index.html"]
  },
  {
    id: "stable-error-contract",
    category: "business-api-contract",
    prompt: "修复 src/customer-service.mjs：lookupCustomer 无论依赖返回失败还是抛错，都必须返回稳定的 { ok:false, error:{ code, message } }，成功结构保持不变。不要改测试；运行测试。",
    files: {
      "package.json": "{\"type\":\"module\",\"scripts\":{\"test\":\"node --test\"}}\n",
      "src/customer-service.mjs": "export async function lookupCustomer(id, gateway) {\n  const response = await gateway.fetch(id);\n  if (!response.ok) return { error: response.message };\n  return { ok: true, customer: response.customer };\n}\n",
      "test/customer-service.test.mjs": "import test from 'node:test'; import assert from 'node:assert/strict'; import { lookupCustomer } from '../src/customer-service.mjs';\ntest('preserves success',async()=>assert.deepEqual(await lookupCustomer('1',{fetch:async()=>({ok:true,customer:{id:'1'}})}),{ok:true,customer:{id:'1'}}));\ntest('normalizes dependency failure',async()=>assert.deepEqual(await lookupCustomer('1',{fetch:async()=>({ok:false,code:'NOT_FOUND',message:'missing'})}),{ok:false,error:{code:'NOT_FOUND',message:'missing'}}));\ntest('normalizes thrown failure',async()=>assert.deepEqual(await lookupCustomer('1',{fetch:async()=>{throw new Error('offline')}}),{ok:false,error:{code:'DEPENDENCY_ERROR',message:'offline'}}));\n"
    },
    command: ["node", "--test"],
    allowedChanges: ["src/customer-service.mjs"]
  }
]);
