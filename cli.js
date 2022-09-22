#!/usr/bin/env node
import sade from 'sade'
import archy from 'archy'
import colors from 'colors'
import { extract } from './index.js'
import * as raw from 'multiformats/codecs/raw'
import * as dagPb from '@ipld/dag-pb'
import { CarIndexedReader } from '@ipld/car/indexed-reader'
import { CarWriter } from '@ipld/car/writer'
import { CID } from 'multiformats/cid'
import { decode as blockDecode } from 'multiformats/block'
import { sha256 as hasher } from 'multiformats/hashes/sha2'

import { createWriteStream } from 'fs'
import { Readable } from 'stream'

const Decoders = {
  [raw.code]: raw,
  [dagPb.code]: dagPb
}

const cli = sade('ipfs-car-tools')

cli.command('extract <path> <car>')
  .describe('Extract ipfs path blocks from a CAR')
  .example('ipfs-car-extract bafybeig5uisjbc25pkjwtyq5goocmwr7lz5ln63llrtw4d5s2y7m7nhyeu/path/to/image.png my.car > image.png.car')
  .option('-o, --output', 'Output path for CAR')
  .action(async (path, car, options) => {
    const reader = await CarIndexedReader.fromFile(car)
    const blocks = extract(reader, path)
    const { writer, out } = CarWriter.create(getRootCidFromPath(path))

    if (options.output) {
      Readable.from(out).pipe(createWriteStream(options.output))
    } else {
      Readable.from(out).pipe(process.stdout)
    }

    for await (const block of blocks) {
      await writer.put(block)
    }
    await writer.close()
  })

cli.command('tree <car>')
  .describe('Print a tree with CIDs in a CAR')
  .action(async (car) => {
    const reader = await CarIndexedReader.fromFile(car)
    const roots = await reader.getRoots()
    const archyRoot = { label: `${colors.green(roots[0].toString())}`, nodes: [] }
    // used to find nodes in the tree
    const allNodes = new Map([[roots[0].toString(), archyRoot]])

    for await (const block of reader.blocks()) {
      const decoder = Decoders[block.cid.code]
      const multiformatsBlock = await blockDecode({ bytes: block.bytes, codec: decoder, hasher })

      let node = allNodes.get(block.cid.toString())
      if (!node) {
        const hasCid = await reader.has(block.cid)
        const label = hasCid ? `${colors.green(block.cid.toString())}` : `${colors.red(block.cid.toString())}`
        const missingNode = { label, nodes: [] }
        allNodes.set(block.cid.toString(), missingNode)
        node = missingNode
      }

      for (const [_, linkCid] of multiformatsBlock.links()) {
        let target = allNodes.get(linkCid.toString())
        if (!target) {
          const hasCid = await reader.has(linkCid)
          const label = hasCid ? `${colors.green(linkCid.toString())}` : `${colors.red(linkCid.toString())}`
          target = { label, nodes: [] }
          allNodes.set(linkCid.toString(), target)
        }

        // @ts-ignore
        node.nodes.push(target)
      }
    }

    console.log(archy(archyRoot))
  })

cli.parse(process.argv)

function getRootCidFromPath (path) {
  if (path.startsWith('/')) {
    path = path.slice(1)
  }
  if (path.endsWith('/')) {
    path = path.slice(0, -1)
  }

  const parts = path.split('/')
  const rootCidStr = parts.shift()
  if (!rootCidStr) {
    throw new Error(`no root cid found in path`)
  }
  return CID.parse(rootCidStr)
}