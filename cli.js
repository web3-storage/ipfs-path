#!/usr/bin/env node
import sade from 'sade'
import archy from 'archy'
import colors from 'colors'
import { extract } from './index.js'
import * as raw from 'multiformats/codecs/raw'
import * as dagPb from '@ipld/dag-pb'
import * as dagCbor from '@ipld/dag-cbor'
import * as dagJson from '@ipld/dag-json'
import { CarBlockIterator, CarWriter, CarIndexedReader } from '@ipld/car'
import { CID } from 'multiformats/cid'
import { decode as blockDecode } from 'multiformats/block'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import { createReadStream, createWriteStream } from 'fs'
import { Readable } from 'stream'
import { exporter } from 'ipfs-unixfs-exporter'

const Decoders = {
  [raw.code]: raw,
  [dagPb.code]: dagPb,
  [dagCbor.code]: dagCbor,
  [dagJson.code]: dagJson
}

const cli = sade('ipfs-car-tools')

cli.command('extract <path> <car>')
  .describe('Extract IPFS path blocks from a CAR')
  .example('ipfs-car-tools extract bafybeig5uisjbc25pkjwtyq5goocmwr7lz5ln63llrtw4d5s2y7m7nhyeu/path/to/image.png my.car > image.png.car')
  .option('-o, --output', 'Output path for CAR')
  .action(async (path, car, options) => {
    const reader = await CarIndexedReader.fromFile(car)
    const blocks = extract(reader, path)
    const { writer, out } = CarWriter.create(getRootCidFromPath(path))
    const dest = options.output ? createWriteStream(options.output) : process.stdout

    Readable.from(out).pipe(dest)

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
      if (!decoder) throw new Error(`Missing decoder: ${block.cid.code}`)
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

cli.command('export <path> <car>')
  .describe('Export a UnixFS file from a CAR')
  .example('ipfs-car-tools export bafybeig5uisjbc25pkjwtyq5goocmwr7lz5ln63llrtw4d5s2y7m7nhyeu/path/to/image.png image.png.car > image.png')
  .option('-o, --output', 'Output path for file')
  .action(async (path, car, options) => {
    const blocks = (await CarBlockIterator.fromIterable(createReadStream(car)))[Symbol.asyncIterator]()
    const blockstore = {
      async get (key) {
        const { done, value } = await blocks.next()
        if (done) throw new Error('unexpected EOF')
        if (value.cid.toString() !== key.toString()) {
          throw new Error(`CID mismatch, expected: ${key}, received: ${value.cid}`)
        }
        return value.bytes
      }
    }
    const entry = await exporter(path, blockstore)
    if (entry.type === 'directory') throw new Error(`${path} is a directory`)
    const dest = options.output ? createWriteStream(options.output) : process.stdout
    Readable.from(entry.content()).pipe(dest)
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