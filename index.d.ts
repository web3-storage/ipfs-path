import { CID } from 'multiformats/cid'

export interface Block {
  cid: CID
  bytes: Uint8Array
}

export interface Blockstore {
  get: (key: CID) => Promise<Block|undefined>
}

export declare function extract (blockstore: Blockstore, path: string): AsyncIterable<Block>
