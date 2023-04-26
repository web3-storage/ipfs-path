// This is a modified find-cid-in-shard.js from ipfs-unixfs-exporter
import { Bucket, createHAMT } from 'hamt-sharding'
import { decode } from '@ipld/dag-pb'
import { murmur3128 } from '@multiformats/murmur3'

/**
 * @typedef {{ cid: CID, bytes: Uint8Array }} Block
 * @typedef {{ get: (key: CID) => Promise<Block|undefined> }} Blockstore
 * @typedef {import('multiformats/cid').CID} CID
 * @typedef {import('@ipld/dag-pb').PBNode} PBNode
 * @typedef {import('@ipld/dag-pb').PBLink} PBLink
 */

/**
 * @param {Uint8Array} buf
 */
const hashFn = async function (buf) {
  return (await murmur3128.encode(buf))
    // Murmur3 outputs 128 bit but, accidentally, IPFS Go's
    // implementation only uses the first 64, so we must do the same
    // for parity..
    .slice(0, 8)
    // Invert buffer because that's how Go impl does it
    .reverse()
}

/**
 * @param {PBLink[]} links
 * @param {Bucket<boolean>} bucket
 * @param {Bucket<boolean>} rootBucket
 */
const addLinksToHamtBucket = (links, bucket, rootBucket) => {
  return Promise.all(
    links.map(link => {
      if (link.Name == null) {
        // TODO(@rvagg): what do? this is technically possible
        throw new Error('Unexpected Link without a Name')
      }
      if (link.Name.length === 2) {
        const pos = parseInt(link.Name, 16)

        return bucket._putObjectAt(pos, new Bucket({
          hash: rootBucket._options.hash,
          bits: rootBucket._options.bits
        }, bucket, pos))
      }

      return rootBucket.put(link.Name.substring(2), true)
    })
  )
}

/**
 * @param {number} position
 */
const toPrefix = (position) => {
  return position
    .toString(16)
    .toUpperCase()
    .padStart(2, '0')
    .substring(0, 2)
}

/**
 * @param {import('hamt-sharding').BucketPosition<boolean>} position
 */
const toBucketPath = (position) => {
  let bucket = position.bucket
  const path = []

  while (bucket._parent) {
    path.push(bucket)

    bucket = bucket._parent
  }

  path.push(bucket)

  return path.reverse()
}

/**
 * @typedef {object} ShardTraversalContext
 * @property {number} hamtDepth
 * @property {Bucket<boolean>} rootBucket
 * @property {Bucket<boolean>} lastBucket
 *
 * @param {PBNode} node
 * @param {string} name
 * @param {Blockstore} blockstore
 * @param {ShardTraversalContext} [context]
 * @param {{ signal: AbortSignal }} [options]
 * @returns {AsyncIterable<Block>}
 */
export async function * findShardedBlock (node, name, blockstore, context, options) {
  if (!context) {
    const rootBucket = createHAMT({ hashFn })
    context = {
      rootBucket,
      hamtDepth: 1,
      lastBucket: rootBucket
    }
  }

  await addLinksToHamtBucket(node.Links, context.lastBucket, context.rootBucket)

  const position = await context.rootBucket._findNewBucketAndPos(name)
  let prefix = toPrefix(position.pos)
  const bucketPath = toBucketPath(position)

  if (bucketPath.length > context.hamtDepth) {
    context.lastBucket = bucketPath[context.hamtDepth]
    prefix = toPrefix(context.lastBucket._posAtParent)
  }

  const link = node.Links.find(link => {
    if (link.Name == null) {
      return false
    }

    const entryPrefix = link.Name.substring(0, 2)
    const entryName = link.Name.substring(2)

    if (entryPrefix !== prefix) {
      // not the entry or subshard we're looking for
      return false
    }

    if (entryName && entryName !== name) {
      // not the entry we're looking for
      return false
    }

    return true
  })

  if (!link) {
    return
  }

  if (link.Name != null && link.Name.substring(2) === name) {
    // @ts-expect-error no options on our blockstore
    const block = await blockstore.get(link.Hash, options)
    if (!block) {
      throw new Error(`missing block: ${link.Hash}`)
    }
    yield block
    return
  }

  context.hamtDepth++
  // @ts-expect-error no options on our blockstore
  const block = await blockstore.get(link.Hash, options)
  if (!block) {
    throw new Error(`missing block: ${link.Hash}`)
  }
  yield block

  node = decode(block.bytes)
  yield * findShardedBlock(node, name, blockstore, context, options)
}
