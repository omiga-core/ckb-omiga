import { Collector } from '../../src/collector'
import { addressFromP256PrivateKey, keyFromP256Private } from '../../src/utils'
import { Aggregator } from '../../src/aggregator'
import { buildTransferCKBTx } from '../../src/inscription'
import { ConnectResponseData } from '@joyid/ckb'
import { signSecp256r1Tx } from './secp256r1'
import { JoyIDConfig } from '../../src'
import { AddressPrefix } from '@nervosnetwork/ckb-sdk-utils'

// SECP256R1 private key
const TEST_MAIN_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000003'

const transferCkb = async () => {
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

  const receiverPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000002'
  const toAddress =
    'ckt1qrfrwcdnvssswdwpn3s9v8fp87emat306ctjwsm3nmlkjg8qyza2cqgqqy9rpkwdykw5070naqkfekt8c5mucldj8vjm83d3'

  console.log('toAddress:', toAddress)
  const rawTx = await buildTransferCKBTx({
    collector,
    cellDeps: [],
    joyID,
    address,
    toAddress,
  })

  const key = keyFromP256Private(TEST_MAIN_PRIVATE_KEY)
  const signedTx = signSecp256r1Tx(key, rawTx)

  let txHash = await collector.getCkb().rpc.sendTransaction(signedTx, 'passthrough')
  console.info(`Ckb has been transferred with tx hash ${txHash}`)
}

transferCkb()
