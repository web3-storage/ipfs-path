import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { TransformStream } from 'node:stream/web'
import { CarWriter, CarIndexedReader } from '@ipld/car'
import * as UnixFS from '@ipld/unixfs'
import test from 'ava'

test('cli extract dagPB path', async t => {
  const carName = 'extract-me.car'
  const outName = 'extracted.car'
  t.teardown(() => {
    fs.rmSync(carName, { force: true })
    fs.rmSync(outName, { force: true })
  })

  // @ts-expect-error QueuingStrategySize `size` type doesn't fit
  const { readable, writable } = new TransformStream({}, UnixFS.withCapacity(1048576 * 32))
  const writer = UnixFS.createWriter({ writable })

  const file1 = writer.createFileWriter()
  file1.write(new TextEncoder().encode('one'))
  const file1Link = await file1.close()

  const file2 = writer.createFileWriter()
  file2.write(new TextEncoder().encode('two'))
  const file2Link = await file2.close()

  const dir = writer.createDirectoryWriter()
  dir.set('one', file1Link)
  dir.set('two', file2Link)
  const dirLink = await dir.close()
  writer.close()

  const path = `${dirLink.cid}/one`

  // @ts-expect-error Link type doesn't satisfy CID type expected.
  const { writer: carWriter, out } = CarWriter.create(dirLink.cid)
  const fsStream = Readable.from(out).pipe(fs.createWriteStream(carName))

  for await (const block of readable) {
    await carWriter.put(block)
  }

  await carWriter.close()

  // wait for car to be written to fs
  await new Promise((resolve, reject) => {
    if (fsStream.closed) return resolve(true)
    fsStream.once('finish', resolve)
    fsStream.once('error', reject)
  })

  execSync(`./cli.js ${path} ${carName} -o ${outName}`)

  const actual = await CarIndexedReader.fromFile(outName)
  const blocks = []
  for await (const block of actual.blocks()) {
    blocks.push(block)
  }
  t.is(blocks.length, 2, 'extracted car should have 2 out of the 3 blocks in it')
  t.deepEqual(blocks[0].cid, dirLink.cid, 'first block should be the root as we traversed it')
  t.deepEqual(blocks[1].cid, file1Link.cid, 'second block should be file1')
})
