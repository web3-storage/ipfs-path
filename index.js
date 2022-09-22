import * as raw from 'multiformats/codecs/raw'
import { Block } from 'multiformats/block'
import * as dagPB from '@ipld/dag-pb'

/**
 * @typedef {import('multiformats').CID} CID
 * @typedef {{ get: (key: CID) => Promise<Block|undefined> }} Blockstore
 * @typedef {{ cid: CID, bytes: Uint8Array }} Block
 */

/**
 * @param {Blockstore} blockstore Block storage
 * @param {string} path IPFS path to extract
 * @returns {AsyncIterable<Block>}
 */
export function extract (blockstore, path) {
  return (async function * () {
    if (path.startsWith('/')) {
      path = path.slice(1)
    }
    if (path.endsWith('/')) {
      path = path.slice(0, -1)
    }
  
    const parts = path.split('/')
    const rootCid = CID.parse(parts.shift())
  
    const rootBlock = await blockstore.get(rootCid)
    if (!rootBlock) {
      throw new Error(`missing root block: ${rootBlock}`)
    }

    let block = rootBlock
    while (parts.length) {
      const part = parts.shift()
      switch (block.cid.code) {
        case dagPB: {
          const node = dagPB.decode(block.bytes)
          const link = Array.from(new Block({ ...block, value: node }).links()).find(([name]) => name === part)
          if (!link) {
            throw new Error(`missing link "${part}" in CID: ${block.cid}`)
          }
          yield block
          block = await blockstore.get(link[1])
          break
        }
        case raw.code:
          throw new Error(`missing link "${part}" in CID: ${block.cid}`)
        default:
          throw new Error(`unsupported codec: ${cid.code}`)
      }
    }
    yield * exportBlocks(blockstore, block)
  })()
}

/**
 * @param {Blockstore} blockstore Block storage
 * @param {Block} block Root block to export
 * @returns {AsyncIterable<Block>}
 */
async function * exportBlocks (blockstore, block) {
  yield block
  switch (block.cid.code) {
    case dagPB: {
      const node = dagPB.decode(block.bytes)
      const links = new Block({ ...block, value: node }).links()
      const blocks = await Promise.all(links.map(([, cid]) => blockstore.get(cid)))
      for (const b of blocks) {
        yield * exportBlocks(b)
      }
      break
    }
    case raw.code:
      break
    default:
      throw new Error(`unsupported codec: ${cid.code}`)
  }
}
