# ipfs-car-extract

Extract UnixFS paths from an existing DAG with merkle proofs.

A UnixFS DAG can be large, containing multiple levels of files and directories. This tool allows you to extract a portion of a DAG by specifying the path of a file/directory. The tool will export all the blocks for the targeted file and directory as well as the intermediate blocks traversed to reach the target (the proof).

## Install

```sh
npm i ipfs-car-extract
```

## Usage

```js
import { CarIndexedReader } from '@ipld/car/indexed-reader'
import { CarWriter } from '@ipld/car/writer'
import { extract } from 'ipfs-car-extract'
import { Readable } from 'stream'

const reader = await CarIndexedReader.fromFile('my.car')
const blocks = extract(reader, 'bafybeig5uisjbc25pkjwtyq5goocmwr7lz5ln63llrtw4d5s2y7m7nhyeu/path/to/image.png')
const { writer, out } = CarWriter.create('bafybeig5uisjbc25pkjwtyq5goocmwr7lz5ln63llrtw4d5s2y7m7nhyeu')

Readable.from(out).pipe(process.stdout)

for await (const block of blocks) {
  await writer.put(block)
}
await writer.close()
```

### CLI

```sh
ipfs-car-extract bafybeig5uisjbc25pkjwtyq5goocmwr7lz5ln63llrtw4d5s2y7m7nhyeu/path/to/image.png my.car > image.png.car

# You can also extract a DAG that spans multiple CARs:
# ipfs-car-extract <ipfs-path> <car-file> [...car-file]
```
