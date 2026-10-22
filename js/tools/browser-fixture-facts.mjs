import assert from 'node:assert/strict'

const ROW_LIMIT = 20
const BLOCK_LIMIT = 10000n
const LOG_BLOCK_CHUNK = 1000n

export async function collectFixtureFacts({ client, config, contracts, account }) {
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const failure = new Error('Deployment facts exceeded 20 seconds. Check the local RPC and try Refresh.')
      controller.abort(failure)
      reject(failure)
    }, 20000)
  })
  try { return await Promise.race([readFixtureFacts({ client, config, contracts, account, signal: controller.signal }), deadline]) }
  finally { clearTimeout(timer) }
}

async function readFixtureFacts({ client, config, contracts, account, signal }) {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
  signal.throwIfAborted()
  const fromBlock = blockNumber >= BLOCK_LIMIT ? blockNumber - BLOCK_LIMIT + 1n : 0n
  let scannedEvents = false
  function contract(name) {
    assert(Object.hasOwn(contracts, name), `Cannot inspect an unpinned fixture contract: ${name}`)
    return contracts[name]
  }
  async function read(name, functionName, args) {
    signal.throwIfAborted()
    const target = contract(name)
    assert(target.abi.some(item => item.type === 'function' && item.name === functionName && ['view', 'pure'].includes(item.stateMutability)), `Fixture fact read is not a declared read: ${name}.${functionName}`)
    return client.readContract({ ...target, functionName, args, blockNumber })
  }
  async function latestEvents(name, eventName, argument) {
    scannedEvents = true
    const target = contract(name)
    const event = target.abi.find(item => item.type === 'event' && item.name === eventName)
    assert(event, `Fixture discovery event is not declared: ${name}.${eventName}`)
    const values = new Set()
    for (let end = blockNumber; end >= fromBlock && values.size < ROW_LIMIT;) {
      signal.throwIfAborted()
      const start = end - fromBlock >= LOG_BLOCK_CHUNK ? end - LOG_BLOCK_CHUNK + 1n : fromBlock
      const logs = await client.getLogs({ address: target.address, event, fromBlock: start, toBlock: end, strict: true })
      assert(logs.length <= 2000, 'Cannot inspect fixture: too many events in a discovery chunk')
      logs.sort((a, b) => a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1)
      for (const log of logs) {
        assert(typeof log.args[argument] === 'string', `Fixture discovery event is missing ${argument}`)
        values.add(log.args[argument])
        if (values.size === ROW_LIMIT) break
      }
      end = start - 1n
    }
    return [...values]
  }
  const facts = await config.collectFacts({ read, latestEvents, account, limit: ROW_LIMIT })
  assert(facts.rows.length <= ROW_LIMIT, 'Fixture collector exceeded its row limit')
  return { ...facts, blockNumber: blockNumber.toString(), ...(scannedEvents ? { scope: `Most recent registrations, up to ${ROW_LIMIT}; search limited to blocks ${fromBlock}–${blockNumber}.` } : {}) }
}
