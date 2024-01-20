import {
  addressToScript,
  blake160,
  serializeRawTransaction,
  serializeScript,
  serializeWitnessArgs,
} from '@nervosnetwork/ckb-sdk-utils'
import { getJoyIDCellDep, getCotaTypeScript, getXudtDep, getXinsDep } from '../constants'
import { DestroyXinsParams, DestroyXudtParams, Hex, MergeXudtParams, SubkeyUnlockReq } from '../types'
import { calcMinChangeCapacity, calculateTransactionFee } from './helper'
import { append0x } from '../utils'
import { InscriptionXudtException, NoCotaCellException, NoLiveCellException } from '../exceptions'

export const buildDestroyXudtTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  xudtType,
  feeRate,
  cellCount,
}: DestroyXudtParams): Promise<CKBComponents.RawTransaction> => {
  const isMainnet = address.startsWith('ckb')
  const fromLock = addressToScript(address)

  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getXudtDep(isMainnet)]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }

  const xudtCells = await collector.getCells({
    lock: fromLock,
    type: xudtType,
  })
  if (!xudtCells || xudtCells.length === 0) {
    throw new InscriptionXudtException('The address has no xudt cells')
  }

  let {
    inputs: xudtInputs,
    amount: _xudtAmount,
    capacity: xudtCapacity,
  } = collector.collectAllXudtInputs(xudtCells.slice(0, cellCount))

  inputs.push(...xudtInputs)

  let totalInputCapacity = xudtCapacity

  let totalOutputCapacity = BigInt(0)

  const changeOutput: CKBComponents.CellOutput = {
    capacity: `0x00`,
    lock: fromLock,
  }
  outputs.push(changeOutput)
  outputsData.push('0x')

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

  if (totalInputCapacity >= totalOutputCapacity + txFee + minChangeCapacity) {
    const changeCapacity = totalInputCapacity - (totalOutputCapacity + txFee)
    rawTx.outputs[0].capacity = `0x${changeCapacity.toString(16)}`

    return rawTx
  }

  const needCapacity = totalOutputCapacity + txFee - totalInputCapacity
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
  totalInputCapacity += feeInputCapacity

  const changeCapacity = totalInputCapacity - (totalOutputCapacity + txFee)
  rawTx.outputs[0].capacity = `0x${changeCapacity.toString(16)}`

  return rawTx
}

export const buildDestroyXinsTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  xinsType,
  feeRate,
  cellCount,
}: DestroyXinsParams): Promise<CKBComponents.RawTransaction> => {
  const isMainnet = address.startsWith('ckb')
  const fromLock = addressToScript(address)

  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getXinsDep(isMainnet)]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }

  const xinsCells = await collector.getCells({
    lock: fromLock,
    type: xinsType,
  })
  if (!xinsCells || xinsCells.length === 0) {
    throw new InscriptionXudtException('The address has no xudt cells')
  }

  let {
    inputs: xudtInputs,
    amount: _xudtAmount,
    capacity: xudtCapacity,
  } = collector.collectAllXudtInputs(xinsCells.slice(0, cellCount))

  inputs.push(...xudtInputs)

  let totalInputCapacity = xudtCapacity

  let totalOutputCapacity = BigInt(0)

  const changeOutput: CKBComponents.CellOutput = {
    capacity: `0x00`,
    lock: fromLock,
  }
  outputs.push(changeOutput)
  outputsData.push('0x')

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

  if (totalInputCapacity >= totalOutputCapacity + txFee + minChangeCapacity) {
    const changeCapacity = totalInputCapacity - (totalOutputCapacity + txFee)
    rawTx.outputs[0].capacity = `0x${changeCapacity.toString(16)}`

    return rawTx
  }

  const needCapacity = totalOutputCapacity + txFee - totalInputCapacity
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
  totalInputCapacity += feeInputCapacity

  const changeCapacity = totalInputCapacity - (totalOutputCapacity + txFee)
  rawTx.outputs[0].capacity = `0x${changeCapacity.toString(16)}`

  return rawTx
}
