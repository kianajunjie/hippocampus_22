import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, listCount, toPositiveInt } from '../src/cli-args.mjs'

test('解析：位置参数与 --flag 值混排', () => {
  const { flags, positional } = parseArgs(['20', '--subject', '主人', '--pin'])
  assert.deepEqual(positional, ['20'])
  assert.equal(flags.subject, '主人')
  assert.equal(flags.pin, true)
})

test('解析：--key 后面紧跟另一个 --key 时按布尔处理', () => {
  const { flags } = parseArgs(['--pin', '--db', 'x/memory.db'])
  assert.equal(flags.pin, true)
  assert.equal(flags.db, 'x/memory.db')
})

test('解析：含空格的中文参数保持完整', () => {
  const { positional } = parseArgs(['她', '说', '腿疼'])
  assert.deepEqual(positional, ['她', '说', '腿疼'])
})

test('list 条数：位置参数优先于 --limit', () => {
  assert.equal(listCount(['5'], { limit: '50' }), 5)
})

test('list 条数：没有位置参数时用 --limit', () => {
  assert.equal(listCount([], { limit: '7' }), 7)
})

test('list 条数：都没有时走默认 20', () => {
  assert.equal(listCount([], {}), 20)
})

test('list 条数：非法输入回退默认值（不崩）', () => {
  assert.equal(listCount(['abc'], { limit: '-3' }), 20)
  assert.equal(toPositiveInt('abc'), 0)
  assert.equal(toPositiveInt('3.9'), 3)
})
