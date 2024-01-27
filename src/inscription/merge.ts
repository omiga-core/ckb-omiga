import {
  addressToScript,
  blake160,
  serializeRawTransaction,
  serializeScript,
  serializeWitnessArgs,
} from '@nervosnetwork/ckb-sdk-utils'
import { getJoyIDCellDep, getCotaTypeScript, getXudtDep } from '../constants'
import { EstimateMergeXudtResult, Hex, MergeXudtParams, MergeXudtResult, SubkeyUnlockReq } from '../types'
import { calcMinChangeCapacity, calcXudtCapacity, calculateTransactionFee } from './helper'
import { append0x, u128ToLe } from '../utils'
import { InscriptionXudtException, NoCotaCellException, NoLiveCellException } from '../exceptions'
import { Collector } from '../collector'

export const buildMergeXudtTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  xudtType,
  feeRate,
  cellCount,
}: MergeXudtParams): Promise<MergeXudtResult> => {
  const isMainnet = address.startsWith('ckb')
  const fromLock = addressToScript(address)

  const fromXudtCapacity = calcXudtCapacity(fromLock, false)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  let freedCkb = BigInt(0)
  let remain = false
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

  if (cellCount != undefined) {
    if (xudtCells.length > cellCount) {
      remain = true
    }
  }

  const {
    inputs: xudtInputs,
    amount: totalXudtAmount,
    capacity: totalXudtCapacity,
  } = collector.collectAllXudtInputs(xudtCells.slice(0, cellCount))

  const mergedCellCount = xudtInputs.length

  inputs.push(...xudtInputs)

  let inputCapacity = totalXudtCapacity
  let outputCapacity = fromXudtCapacity
  freedCkb = inputCapacity - outputCapacity

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
    return { rawTx, txFee, freedCkb, amount: totalXudtAmount, cellCount: mergedCellCount, remain }
  }

  if (inputCapacity >= outputCapacity + txFee + minChangeCapacity) {
    const changeCapacity = inputCapacity - (outputCapacity + txFee)
    let changeOutput: CKBComponents.CellOutput = {
      capacity: `0x${changeCapacity.toString(16)}`,
      lock: fromLock,
    }

    rawTx.outputs = [changeOutput, ...outputs]
    rawTx.outputsData = ['0x', ...outputsData]

    return { rawTx, txFee, freedCkb, amount: totalXudtAmount, cellCount: mergedCellCount, remain }
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

  return { rawTx, txFee, freedCkb, amount: totalXudtAmount, cellCount: mergedCellCount, remain }
}

export const estimateMergeXudtTx = async (
  collector: Collector,
  address: string,
  xudtType: CKBComponents.Script,
  cellCount: number,
): Promise<EstimateMergeXudtResult> => {
  const fromLock = addressToScript(address)
  const fromXudtCapacity = calcXudtCapacity(fromLock, false)

  let freedCkb = BigInt(0)
  let remain = false

  const xudtCells = await collector.getCells({
    lock: fromLock,
    type: xudtType,
  })
  if (!xudtCells || xudtCells.length === 0) {
    throw new InscriptionXudtException('The address has no xudt cells')
  }

  if (cellCount != undefined) {
    if (xudtCells.length > cellCount) {
      remain = true
    }
  }

  const { capacity: totalXudtCapacity } = collector.collectAllXudtInputs(xudtCells.slice(0, cellCount))

  let inputCapacity = totalXudtCapacity
  let outputCapacity = fromXudtCapacity
  freedCkb = inputCapacity - outputCapacity

  return { freedCkb, remain }
}
