import {
  addressToScript,
  blake160,
  serializeRawTransaction,
  serializeScript,
  serializeWitnessArgs,
} from '@nervosnetwork/ckb-sdk-utils'
import { FEE, getJoyIDCellDep, getCotaTypeScript, getXudtDep, getXinsDep } from '../constants'
import {
  Hex,
  SubkeyUnlockReq,
  TransferXudtParams,
  TransferXinsParams,
  TransferXudtResult,
  TransferXinsResult,
} from '../types'
import { calcMinChangeCapacity, calcXudtCapacity, calculateTransactionFee } from './helper'
import { append0x, u128ToLe } from '../utils'
import { InscriptionXudtException, NoCotaCellException, NoLiveCellException } from '../exceptions'

export const buildTransferXudtTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  xudtType,
  transferAmount,
  toAddress,
  feeRate,
}: TransferXudtParams): Promise<TransferXudtResult> => {
  const isMainnet = address.startsWith('ckb')

  const fromLock = addressToScript(address)
  const fromXudtCapacity = calcXudtCapacity(fromLock, false)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  const toLock = addressToScript(toAddress)
  const toXudtCapacity = calcXudtCapacity(toLock, false)

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

  let totalXudtInputs: CKBComponents.CellInput[] = []
  let totalXudtAmount: bigint = BigInt(0)
  let totalXudtCapacity: bigint = BigInt(0)
  if (transferAmount != undefined) {
    let {
      inputs: xudtInputs,
      amount: xudtAmount,
      capacity: xudtCapacity,
    } = collector.collectXudtInputs(xudtCells, transferAmount)
    totalXudtInputs = [...xudtInputs]
    totalXudtAmount = xudtAmount
    totalXudtCapacity = xudtCapacity
  } else {
    let { inputs: xudtInputs, amount: xudtAmount, capacity: xudtCapacity } = collector.collectAllXudtInputs(xudtCells)
    totalXudtInputs = [...xudtInputs]
    totalXudtAmount = xudtAmount
    totalXudtCapacity = xudtCapacity
    transferAmount = totalXudtAmount
  }

  inputs.push(...totalXudtInputs)

  let totalInputCapacity = totalXudtCapacity
  let totalOutputCapacity = BigInt(0)

  if (totalXudtAmount > transferAmount) {
    let output: CKBComponents.CellOutput = {
      ...xudtCells[0].output,
    }
    output.capacity = `0x${fromXudtCapacity.toString(16)}`
    outputs.push(output)

    outputsData.push(append0x(u128ToLe(totalXudtAmount - transferAmount)))
    totalOutputCapacity += fromXudtCapacity
  }

  let output: CKBComponents.CellOutput = {
    ...xudtCells[0].output,
    lock: toLock,
  }
  let packagedCkb = toXudtCapacity
  output.capacity = `0x${toXudtCapacity.toString(16)}`
  outputs.push(output)
  outputsData.push(append0x(u128ToLe(transferAmount)))
  totalOutputCapacity += toXudtCapacity

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
  if (totalInputCapacity === totalOutputCapacity + txFee) {
    return { rawTx, txFee, packagedCkb, amount: transferAmount }
  }

  if (
    totalInputCapacity > totalOutputCapacity + txFee &&
    totalInputCapacity < totalOutputCapacity + txFee + BigInt(1)
  ) {
    let remainCapacity = totalInputCapacity - totalOutputCapacity - txFee
    rawTx.outputs[0].capacity = `0x${(BigInt(rawTx.outputs[0].capacity) + remainCapacity).toString(16)}`
    if (rawTx.outputs[0].lock === toLock) {
      packagedCkb += remainCapacity
    }
  }

  if (totalInputCapacity >= totalOutputCapacity + txFee + minChangeCapacity) {
    const changeCapacity = totalInputCapacity - (totalOutputCapacity + txFee)
    let changeOutput: CKBComponents.CellOutput = {
      capacity: `0x${changeCapacity.toString(16)}`,
      lock: fromLock,
    }

    rawTx.outputs = [changeOutput, ...outputs]
    rawTx.outputsData = ['0x', ...outputsData]

    return { rawTx, txFee, packagedCkb, amount: transferAmount }
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

  totalOutputCapacity += changeCapacity

  let changeOutput: CKBComponents.CellOutput = {
    capacity: `0x${changeCapacity.toString(16)}`,
    lock: fromLock,
  }

  rawTx.outputs = [changeOutput, ...outputs]
  rawTx.outputsData = ['0x', ...outputsData]

  return { rawTx, txFee, packagedCkb, amount: transferAmount }
}

export const buildTransferXinsTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  xinsType,
  cellCount,
  toAddress,
  feeRate,
}: TransferXinsParams): Promise<TransferXinsResult> => {
  const isMainnet = address.startsWith('ckb')
  const fromLock = addressToScript(address)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  const toLock = addressToScript(toAddress)
  const toXinsCapacity = calcXudtCapacity(toLock, false)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getXinsDep(isMainnet)]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }

  let totalInputCapacity = BigInt(0)
  let totalOutputCapacity = BigInt(0)
  let packagedCkb = BigInt(0)

  const xinsCells = await collector.getCells({
    lock: fromLock,
    type: xinsType,
  })
  if (!xinsCells || xinsCells.length === 0) {
    throw new InscriptionXudtException('The address has no xudt cells')
  }

  let {
    inputs: xinsInputs,
    capacity: xinsInputsCapacity,
    amount: xinsInputsAmount,
  } = collector.collectAllXudtInputs(xinsCells.slice(cellCount))
  inputs.push(...xinsInputs)

  totalInputCapacity = xinsInputsCapacity

  const count = xinsInputs.length
  for (let index = 0; index < count; index++) {
    let output: CKBComponents.CellOutput = {
      ...xinsCells[0].output,
      lock: toLock,
    }
    output.capacity = `0x${toXinsCapacity.toString(16)}`
    outputs.push(output)
    outputsData.push(xinsCells[index].outputData)
    packagedCkb += toXinsCapacity
  }

  outputs.forEach((value, index) => {
    totalOutputCapacity += BigInt(value.capacity)
  })

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
  if (totalInputCapacity === totalOutputCapacity + txFee) {
    return { rawTx, txFee, packagedCkb, amount: xinsInputsAmount }
  }

  if (
    totalInputCapacity > totalOutputCapacity + txFee &&
    totalInputCapacity < totalOutputCapacity + txFee + BigInt(1)
  ) {
    let remainCapacity = totalInputCapacity - totalOutputCapacity - txFee
    rawTx.outputs[0].capacity = `0x${(BigInt(rawTx.outputs[0].capacity) + remainCapacity).toString(16)}`
    if (rawTx.outputs[0].lock === toLock) {
      packagedCkb += remainCapacity
    }
  }

  if (totalInputCapacity >= totalOutputCapacity + txFee + minChangeCapacity) {
    const changeCapacity = totalInputCapacity - (totalOutputCapacity + txFee)
    let changeOutput: CKBComponents.CellOutput = {
      capacity: `0x${changeCapacity.toString(16)}`,
      lock: fromLock,
    }

    rawTx.outputs = [changeOutput, ...outputs]
    rawTx.outputsData = ['0x', ...outputsData]

    return { rawTx, txFee, packagedCkb, amount: xinsInputsAmount }
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
  let changeOutput: CKBComponents.CellOutput = {
    capacity: `0x${changeCapacity.toString(16)}`,
    lock: fromLock,
  }

  rawTx.outputs = [changeOutput, ...outputs]
  rawTx.outputsData = ['0x', ...outputsData]

  return { rawTx, txFee, packagedCkb, amount: xinsInputsAmount }
}
