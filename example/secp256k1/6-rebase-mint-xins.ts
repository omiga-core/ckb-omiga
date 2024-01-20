import { Collector } from '../../src/collector'
import { append0x } from '../../src/utils'
import { buildRebaseMintXinsTx } from '../../src/inscription'
import { InscriptionXinsInfo, getInscriptionInfoTypeScript } from '../../src'
import { calcRebasedXudtType, calcXinsTypeScript } from '../../src/inscription/helper'
import { AddressPrefix, scriptToHash } from '@nervosnetwork/ckb-sdk-utils'
import { blockchain } from '@ckb-lumos/base'

// SECP256R1 private key
const TEST_MAIN_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000002'

const rebaseMint = async () => {
  const collector = new Collector({
    ckbNodeUrl: 'https://testnet.ckb.dev/rpc',
    ckbIndexerUrl: 'https://testnet.ckb.dev/indexer',
  })
  const address = collector.getCkb().utils.privateKeyToAddress(TEST_MAIN_PRIVATE_KEY, { prefix: AddressPrefix.Testnet })
  console.log('address: ', address)

  // the inscriptionId and preXudtHash come from inscription deploy transaction
  const inscriptionId = '0xe3eca1280df8643d6a567143e7bad012d394b53a6c4df3eded97d57f8b45f9c7'

  // the actual supply comes from the inscription info-rebase transaction
  const actualSupply = BigInt('700000000000')
  const inscriptionXinsInfo: InscriptionXinsInfo = {
    maxSupply: BigInt(2100_0000),
    mintLimit: BigInt(1000),
    xinsHash: '',
    mintStatus: 0,
    decimal: 8,
    name: 'CKB Fist Inscription',
    symbol: 'CKBI',
  }

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(false),
    args: append0x(inscriptionId),
  }
  const preXinsType = calcXinsTypeScript(inscriptionInfoType, false)
  const preXinsHash = scriptToHash(preXinsType)
  const rebasedXudtType = calcRebasedXudtType(inscriptionInfoType, preXinsHash, actualSupply, false)
  const rebaseXudtHash = scriptToHash(rebasedXudtType)

  console.log('rebaseXudtHash: ', rebaseXudtHash)

  const secp256k1Dep: CKBComponents.CellDep = {
    outPoint: {
      txHash: '0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37',
      index: '0x0',
    },
    depType: 'depGroup',
  }

  const { rawTx } = await buildRebaseMintXinsTx({
    collector,
    cellDeps: [secp256k1Dep],
    address,
    inscriptionId,
    actualSupply,
    inscriptionXinsInfo,
  })

  const witnessArgs = blockchain.WitnessArgs.unpack(rawTx.witnesses[0]) as CKBComponents.WitnessArgs
  let unsignedTx: CKBComponents.RawTransactionToSign = {
    ...rawTx,
    witnesses: [witnessArgs, ...rawTx.witnesses.slice(1)],
  }

  // the rebased xudt type script will be used in rebased-transfer
  console.log('rebased xudt type script', JSON.stringify(rebasedXudtType))

  const signedTx = collector.getCkb().signTransaction(TEST_MAIN_PRIVATE_KEY)(unsignedTx)

  let txHash = await collector.getCkb().rpc.sendTransaction(signedTx, 'passthrough')
  console.info(`Inscription xudt has been rebased with tx hash ${txHash}`)
}

rebaseMint()
