import { Collector } from '../../src/collector'
import { addressFromP256PrivateKey, append0x } from '../../src/utils'
import { buildTransferCKBTx } from '../../src/inscription'
import { getInscriptionInfoTypeScript } from '../../src'
import { AddressPrefix } from '@nervosnetwork/ckb-sdk-utils'
import { blockchain } from '@ckb-lumos/base'

// SECP256R1 private key
const TEST_MAIN_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000002'

const transferCkb = async () => {
  const collector = new Collector({
    ckbNodeUrl: 'https://testnet.ckb.dev/rpc',
    ckbIndexerUrl: 'https://testnet.ckb.dev/indexer',
  })
  const address = collector.getCkb().utils.privateKeyToAddress(TEST_MAIN_PRIVATE_KEY, { prefix: AddressPrefix.Testnet })
  console.log('address: ', address)

  // the inscriptionId come from inscription deploy transaction
  const inscriptionId = '0x8d170bed3935f9d23f3fa5a6c3b713ba296c32de366b29541fb65cec8491f218'

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(false),
    args: append0x(inscriptionId),
  }

  const receiverPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000003'
  const toAddress = addressFromP256PrivateKey(receiverPrivateKey)
  console.log('toAddress: ', toAddress)

  const secp256k1Dep: CKBComponents.CellDep = {
    outPoint: {
      txHash: '0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37',
      index: '0x0',
    },
    depType: 'depGroup',
  }

  const rawTx = await buildTransferCKBTx({
    collector,
    cellDeps: [secp256k1Dep],
    address,
    toAddress,
  })

  const witnessArgs = blockchain.WitnessArgs.unpack(rawTx.witnesses[0]) as CKBComponents.WitnessArgs
  let unsignedTx: CKBComponents.RawTransactionToSign = {
    ...rawTx,
    witnesses: [witnessArgs, ...rawTx.witnesses.slice(1)],
  }
  const signedTx = collector.getCkb().signTransaction(TEST_MAIN_PRIVATE_KEY)(unsignedTx)

  let txHash = await collector.getCkb().rpc.sendTransaction(signedTx, 'passthrough')
  console.info(`CKB has been transferred with tx hash ${txHash}`)
}

transferCkb()
