/**
 * @typedef {import('multiformats').CID} CID
 * @typedef {{ get: () => Promise<Block|undefined> }} Blockstore
 * @typedef {{ cid: CID, bytes: Uint8Array }} Block
 */

/**
 * @param {Blockstore} blockstore Block storage
 * @param {string} path IPFS path to extract
 * @returns {AsyncIterable<Block>}
 */
export async function extract (blockstore, path) {

}
