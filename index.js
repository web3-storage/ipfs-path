import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import * as dagPB from '@ipld/dag-pb'
import { UnixFS } from 'ipfs-unixfs'
import { findShardedBlock } from './hamt.js'

/**
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
    const rootCidStr = parts.shift()
    if (!rootCidStr) {
      throw new Error('missing root CID in path')
    }

    const rootCid = CID.parse(rootCidStr)

    const rootBlock = await blockstore.get(rootCid)
    if (!rootBlock) {
      throw new Error(`missing root block: ${rootBlock}`)
    }
    yield rootBlock
    let block = rootBlock
    while (parts.length) {
      const part = parts.shift() ?? ''
      switch (block.cid.code) {
        case dagPB.code: {
          const node = dagPB.decode(block.bytes)
          const unixfs = node.Data ? UnixFS.unmarshal(node.Data) : undefined

          if (unixfs && unixfs.type === 'hamt-sharded-directory') {
            for await (const shardBlock of findShardedBlock(node, part, blockstore)) {
              yield shardBlock
              block = shardBlock
            }
          } else {
            const link = node.Links.find(link => link.Name === part)
            if (!link) {
              throw new Error(`missing link "${part}" in CID: ${block.cid}`)
            }
            const linkBlock = await blockstore.get(link.Hash)
            if (!linkBlock) {
              throw new Error(`missing block: ${linkBlock}`)
            }
            yield linkBlock
            block = linkBlock
          }
          break
        }
        default:
          throw new Error(`unsupported codec: ${block.cid.code}`)
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
  switch (block.cid.code) {
    case dagPB.code: {
      const node = dagPB.decode(block.bytes)
      const links = node.Links.map(link => link.Hash)
      const blocks = await Promise.all(links.map(async (cid) => {
        const block = await blockstore.get(cid)
        if (!block) {
          throw new Error(`missing block: ${cid}`)
        }
        return block
      }))
      for (const b of blocks) {
        yield * exportBlocks(blockstore, b)
      }
      break
    }
    case raw.code:
      break
    default:
      throw new Error(`unsupported codec: ${block.cid.code}`)
  }
}
