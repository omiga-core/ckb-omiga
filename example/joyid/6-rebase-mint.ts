import { Collector } from '../../src/collector'
import { addressFromP256PrivateKey, append0x, keyFromP256Private } from '../../src/utils'
import { Aggregator } from '../../src/aggregator'
import { buildRebaseMintXudtTx, calcInscriptionXudtActualSupply } from '../../src/inscription'
import { ConnectResponseData } from '@joyid/ckb'
import { signSecp256r1Tx } from './secp256r1'
import { InscriptionXudtInfo, JoyIDConfig, getInscriptionInfoTypeScript } from '../../src'
import { calcRebasedXudtType, calcXudtTypeScript } from '../../src/inscription/helper'
import { scriptToHash } from '@nervosnetwork/ckb-sdk-utils'

// SECP256R1 private key
const TEST_MAIN_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000003'

const rebaseMint = async () => {
  const collector = new Collector({
    ckbNodeUrl: 'https://testnet.ckb.dev/rpc',
    ckbIndexerUrl: 'https://testnet.ckb.dev/indexer',
  })
  const address = addressFromP256PrivateKey(TEST_MAIN_PRIVATE_KEY)
  console.log('address: ', address)

  const aggregator = new Aggregator('https://cota.nervina.dev/aggregator')
  // The connectData is the response of the connect with @joyid/ckb
  const connectData: ConnectResponseData = {
    address,
    ethAddress: '',
    nostrPubkey: '',
    pubkey: '',
    keyType: 'main_key',
    alg: -7,
  }
  // The JoyIDConfig is needed if the dapps use JoyID Wallet to connect and sign ckb transaction
  const joyID: JoyIDConfig = {
    aggregator,
    connectData,
  }

  // the inscriptionId and preXudtHash come from inscription deploy transaction
  const inscriptionId = '0x8d170bed3935f9d23f3fa5a6c3b713ba296c32de366b29541fb65cec8491f218'

  // the actual supply comes from the inscription info-rebase transaction
  const actualSupply = BigInt('300000000000')
  const inscriptionXudtInfo: InscriptionXudtInfo = {
    maxSupply: BigInt(2100_0000),
    mintLimit: BigInt(1000),
    xudtHash: '',
    mintStatus: 0,
    decimal: 8,
    name: 'CKB Fist Inscription',
    symbol: 'CKBI',
  }

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(false),
    args: append0x(inscriptionId),
  }
  const preXudtType = calcXudtTypeScript(inscriptionInfoType, false)
  const preXudtHash = scriptToHash(preXudtType)
  const rebasedXudtType = calcRebasedXudtType(inscriptionInfoType, preXudtHash, actualSupply, false)
  const rebaseXudtHash = scriptToHash(rebasedXudtType)

  console.log('rebaseXudtHash: ', rebaseXudtHash)

  const { rawTx } = await buildRebaseMintXudtTx({
    collector,
    cellDeps: [],
    joyID,
    address,
    inscriptionId,
    actualSupply,
    inscriptionXudtInfo,
  })
  // the rebased xudt type script will be used in rebased-transfer
  console.log('rebased xudt type script', JSON.stringify(rebasedXudtType))

  const key = keyFromP256Private(TEST_MAIN_PRIVATE_KEY)
  const signedTx = signSecp256r1Tx(key, rawTx)

  let txHash = await collector.getCkb().rpc.sendTransaction(signedTx, 'passthrough')
  console.info(`Inscription xudt has been rebased with tx hash ${txHash}`)
}

rebaseMint()
