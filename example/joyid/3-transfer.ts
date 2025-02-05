import { Collector } from '../../src/collector'
import { addressFromP256PrivateKey, append0x, keyFromP256Private } from '../../src/utils'
import { Aggregator } from '../../src/aggregator'
import { buildTransferXudtTx } from '../../src/inscription'
import { ConnectResponseData } from '@joyid/ckb'
import { signSecp256r1Tx } from './secp256r1'
import { JoyIDConfig, getInscriptionInfoTypeScript } from '../../src'
import { AddressPrefix, scriptToHash } from '@nervosnetwork/ckb-sdk-utils'
import { calcXudtTypeScript } from '../../src/inscription/helper'

// SECP256R1 private key
const TEST_MAIN_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000003'

const transfer = async () => {
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

  // the inscriptionId come from inscription deploy transaction
  const inscriptionId = '0x8d170bed3935f9d23f3fa5a6c3b713ba296c32de366b29541fb65cec8491f218'

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(false),
    args: append0x(inscriptionId),
  }
  const preXudtType = calcXudtTypeScript(inscriptionInfoType, false)

  const receiverPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000002'
  const toAddress = collector.getCkb().utils.privateKeyToAddress(receiverPrivateKey, { prefix: AddressPrefix.Testnet })

  console.log('toAddress:', toAddress)
  const {
    rawTx,
    packagedCkb,
    amount: transferAmount,
  } = await buildTransferXudtTx({
    collector,
    cellDeps: [],
    joyID,
    address,
    xudtType: preXudtType,
    toAddress,
  })

  console.log('packageCkb: ', packagedCkb)
  console.log('transferAmount: ', transferAmount)
  const key = keyFromP256Private(TEST_MAIN_PRIVATE_KEY)
  const signedTx = signSecp256r1Tx(key, rawTx)

  let txHash = await collector.getCkb().rpc.sendTransaction(signedTx, 'passthrough')
  console.info(`Inscription has been transferred with tx hash ${txHash}`)
}

transfer()
