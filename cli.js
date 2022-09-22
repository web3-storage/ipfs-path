import sade from 'sade'

import { extract } from './index.js'
import { CarIndexedReader } from '@ipld/car/indexed-reader'
import { CarWriter } from '@ipld/car/writer'
import { CID } from 'multiformats/cid'

import { createWriteStream } from 'fs'
import { Readable } from 'stream'

sade('ipfs-car-extract <path> <car>', true)
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
  .parse(process.argv)


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