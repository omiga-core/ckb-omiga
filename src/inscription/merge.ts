import {
  addressToScript,
  blake160,
  serializeRawTransaction,
  serializeScript,
  serializeWitnessArgs,
} from '@nervosnetwork/ckb-sdk-utils'
import { FEE, getJoyIDCellDep, getCotaTypeScript, getXudtDep } from '../constants'
import { Hex, MergeXudtParams, SubkeyUnlockReq } from '../types'
import { calcMinChangeCapacity, calcXudtCapacity, calculateTransactionFee } from './helper'
import { append0x, u128ToLe } from '../utils'
import { InscriptionXudtException, NoCotaCellException, NoLiveCellException } from '../exceptions'

export const buildMergeXudtTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  xudtType,
  feeRate,
  cellCount,
}: MergeXudtParams): Promise<CKBComponents.RawTransaction> => {
  const isMainnet = address.startsWith('ckb')
  const fromLock = addressToScript(address)

  const fromXudtCapacity = calcXudtCapacity(fromLock, false)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getXudtDep(isMainnet)]

  const xudtCells = await collector.getCells({
    lock: fromLock,
    type: xudtType,
  })
  if (!xudtCells || xudtCells.length === 0) {
    throw new InscriptionXudtException('The address has no xudt cells')
  }

  let {
    inputs: xudtInputs,
    amount: xudtAmount,
    capacity: xudtCapacity,
  } = collector.collectAllXudtInputs(xudtCells.slice(0, cellCount))

  inputs.push(...xudtInputs)

  const totalXudtAmount = xudtAmount
  const totalXudtCapacity = xudtCapacity

  let inputCapacity = totalXudtCapacity
  let outputCapacity = fromXudtCapacity

  let output: CKBComponents.CellOutput = {
    ...xudtCells[0].output,
    lock: fromLock,
  }
  output.capacity = `0x${fromXudtCapacity.toString(16)}`

  outputs.push(output)
  outputsData.push(append0x(u128ToLe(totalXudtAmount)))

  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }
  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  let witnesses = [serializeWitnessArgs(emptyWitness)]
  if (joyID && joyID.connectData.keyType === 'sub_key') {
    const pubkeyHash = append0x(blake160(append0x(joyID.connectData.pubkey), 'hex'))
    const req: SubkeyUnlockReq = {
      lockScript: serializeScript(fromLock),
      pubkeyHash,
      algIndex: 1, // secp256r1
    }
    const { unlockEntry } = await joyID.aggregator.generateSubkeyUnlockSmt(req)
    const emptyWitness = {
      lock: '',
      inputType: '',
      outputType: append0x(unlockEntry),
    }
    witnesses[0] = serializeWitnessArgs(emptyWitness)

    const cotaType = getCotaTypeScript(isMainnet)
    const cotaCells = await collector.getCells({ lock: fromLock, type: cotaType })
    if (!cotaCells || cotaCells.length === 0) {
      throw new NoCotaCellException("Cota cell doesn't exist")
    }
    const cotaCell = cotaCells[0]
    const cotaCellDep: CKBComponents.CellDep = {
      outPoint: cotaCell.outPoint,
      depType: 'code',
    }
    cellDeps = [cotaCellDep, ...cellDeps]
  }

  const rawTx: CKBComponents.RawTransaction = {
    version: '0x0',
    cellDeps,
    headerDeps: [],
    inputs,
    outputs,
    outputsData,
    witnesses,
  }

  let serializedTx = serializeRawTransaction(rawTx)
  let txSize = serializedTx.length + 200
  let txFee = calculateTransactionFee(feeRate ? feeRate : BigInt(1500), txSize)

  if (inputCapacity === outputCapacity + txFee) {
    return rawTx
  }

  if (inputCapacity >= outputCapacity + txFee + minChangeCapacity) {
    const changeCapacity = inputCapacity - (outputCapacity + txFee)
    let changeOutput: CKBComponents.CellOutput = {
      capacity: `0x${changeCapacity.toString(16)}`,
      lock: fromLock,
    }

    rawTx.outputs = [changeOutput, ...outputs]
    rawTx.outputsData = ['0x', ...outputsData]

    return rawTx
  }

  const needCapacity = outputCapacity + txFee - inputCapacity
  const cells = await collector.getCells({ lock: fromLock })
  if (!cells || cells.length === 0) {
    throw new NoLiveCellException('The address has no live cells')
  }
  let { inputs: feeInputs, capacity: feeInputCapacity } = collector.collectInputs(
    cells,
    needCapacity,
    minChangeCapacity,
    txFee,
  )
  rawTx.inputs.push(...feeInputs)
  inputCapacity += feeInputCapacity

  const changeCapacity = inputCapacity - (outputCapacity + txFee)
  let changeOutput: CKBComponents.CellOutput = {
    capacity: `0x${changeCapacity.toString(16)}`,
    lock: fromLock,
  }

  rawTx.outputs = [changeOutput, ...outputs]
  rawTx.outputsData = ['0x', ...outputsData]

  return rawTx
}
