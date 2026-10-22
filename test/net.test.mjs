import test from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultResultOrder } from 'node:dns'
import '../src/net.js'

test('prefers IPv4 resolution by default', () => {
  assert.equal(getDefaultResultOrder(), 'ipv4first')
})
