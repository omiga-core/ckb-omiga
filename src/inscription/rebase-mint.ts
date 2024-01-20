import {
  addressToScript,
  blake160,
  hexToBytes,
  scriptToHash,
  serializeRawTransaction,
  serializeScript,
  serializeWitnessArgs,
} from '@nervosnetwork/ckb-sdk-utils'
import {
  FEE,
  getJoyIDCellDep,
  getInscriptionInfoTypeScript,
  getCotaTypeScript,
  getXudtDep,
  getRebaseDep,
  getXinsDep,
} from '../constants'
import { RebaseMintXudtParams, RebaseMintXinsParams, RebaseMintResult, SubkeyUnlockReq, Hex } from '../types'
import {
  calcRebasedXudtType,
  calcXudtTypeScript,
  calcRebasedXudtWitness,
  calculateTransactionFee,
  calcXinsTypeScript,
  calcXudtCapacity,
  calcMinChangeCapacity,
} from './helper'
import { append0x, u128ToLe } from '../utils'
import {
  InscriptionInfoException,
  InscriptionXudtException,
  NoCotaCellException,
  NoLiveCellException,
} from '../exceptions'

export const buildRebaseMintXudtTx = async ({
  collector,
  joyID,
  cellDeps,
  address,
  inscriptionId,
  inscriptionXudtInfo,
  actualSupply,
  cellCount,
  feeRate,
}: RebaseMintXudtParams): Promise<RebaseMintResult> => {
  const isMainnet = address.startsWith('ckb')
  const fromLock = addressToScript(address)
  const rebasedXudtCapacity = calcXudtCapacity(fromLock, false)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getXudtDep(isMainnet), getRebaseDep(isMainnet)]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: append0x(inscriptionId),
  }
  const preXudtType = calcXudtTypeScript(inscriptionInfoType, isMainnet)
  const preXudtHash = scriptToHash(preXudtType)
  const xudtCells = await collector.getCells({ lock: fromLock, type: preXudtType })
  if (!xudtCells || xudtCells.length === 0) {
    throw new InscriptionXudtException('The address has no inscription cells and please mint first')
  }

  let {
    inputs: preXudtInputs,
    amount: preTotalAmount,
    capacity: totalInputCapacity,
  } = collector.collectAllXudtInputs(xudtCells.slice(0, cellCount))
  inputs.push(...preXudtInputs)

  const inscriptionInfoCells = await collector.getCells({ type: inscriptionInfoType })
  if (!inscriptionInfoCells || inscriptionInfoCells.length === 0) {
    throw new InscriptionInfoException('There is no inscription info cell with the given inscription id')
  }
  const inscriptionInfoCellDep: CKBComponents.CellDep = {
    outPoint: inscriptionInfoCells[0].outPoint,
    depType: 'code',
  }
  cellDeps.push(inscriptionInfoCellDep)

  const exceptedSupply = inscriptionXudtInfo.maxSupply * BigInt(10 ** inscriptionXudtInfo.decimal)
  const expectedTotalAmount = preTotalAmount * exceptedSupply
  const actualRebasedAmount = expectedTotalAmount / actualSupply

  const changeOutput: CKBComponents.CellOutput = {
    capacity: `0x00`,
    lock: fromLock,
  }
  outputs.push(changeOutput)
  outputsData.push('0x')

  const rebasedXudtType = calcRebasedXudtType(inscriptionInfoType, preXudtHash, actualSupply, isMainnet)
  const xudtOutput: CKBComponents.CellOutput = {
    capacity: `0x${rebasedXudtCapacity.toString(16)}`,
    lock: fromLock,
    type: rebasedXudtType,
  }
  outputs.push(xudtOutput)
  outputsData.push(append0x(u128ToLe(actualRebasedAmount)))

  let totalOutputCapacity = rebasedXudtCapacity

  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  let witnesses = [
    serializeWitnessArgs(emptyWitness),
    calcRebasedXudtWitness(inscriptionInfoType, preXudtHash, actualSupply, isMainnet),
  ]
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
    return { rawTx, rebasedXudtType }
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
  return { rawTx, rebasedXudtType }
}

export const buildRebaseMintXinsTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  inscriptionId,
  inscriptionXinsInfo,
  actualSupply,
  cellCount,
  feeRate,
}: RebaseMintXinsParams): Promise<RebaseMintResult> => {
  const isMainnet = address.startsWith('ckb')
  const fromLock = addressToScript(address)
  const rebasedXudtCapacity = calcXudtCapacity(fromLock, false)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getXinsDep(isMainnet), getXudtDep(isMainnet), getRebaseDep(isMainnet)]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: append0x(inscriptionId),
  }
  const preXinsType = calcXinsTypeScript(inscriptionInfoType, isMainnet)
  const preXinsHash = scriptToHash(preXinsType)
  const xinsCells = await collector.getCells({ lock: fromLock, type: preXinsType })
  if (!xinsCells || xinsCells.length === 0) {
    throw new InscriptionXudtException('The address has no inscription cells and please mint first')
  }

  let {
    inputs: preXinsInputs,
    amount: preTotalAmount,
    capacity: totalInputCapacity,
  } = collector.collectAllXudtInputs(xinsCells.slice(0, cellCount))
  inputs.push(...preXinsInputs)

  const inscriptionInfoCells = await collector.getCells({ type: inscriptionInfoType })
  if (!inscriptionInfoCells || inscriptionInfoCells.length === 0) {
    throw new InscriptionInfoException('There is no inscription info cell with the given inscription id')
  }
  const inscriptionInfoCellDep: CKBComponents.CellDep = {
    outPoint: inscriptionInfoCells[0].outPoint,
    depType: 'code',
  }
  cellDeps.push(inscriptionInfoCellDep)

  const exceptedSupply = inscriptionXinsInfo.maxSupply * BigInt(10 ** inscriptionXinsInfo.decimal)
  const expectedTotalAmount = preTotalAmount * exceptedSupply
  const actualRebasedAmount = expectedTotalAmount / actualSupply

  const changeOutput: CKBComponents.CellOutput = {
    capacity: `0x00`,
    lock: fromLock,
  }
  outputs.push(changeOutput)
  outputsData.push('0x')

  const rebasedXudtType = calcRebasedXudtType(inscriptionInfoType, preXinsHash, actualSupply, isMainnet)
  const xudtOutput: CKBComponents.CellOutput = {
    capacity: `0x${rebasedXudtCapacity.toString(16)}`,
    lock: fromLock,
    type: rebasedXudtType,
  }
  outputs.push(xudtOutput)
  outputsData.push(append0x(u128ToLe(actualRebasedAmount)))

  let totalOutputCapacity = rebasedXudtCapacity

  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  let witnesses = [
    serializeWitnessArgs(emptyWitness),
    calcRebasedXudtWitness(inscriptionInfoType, preXinsHash, actualSupply, isMainnet),
  ]
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
    return { rawTx, rebasedXudtType }
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
  return { rawTx, rebasedXudtType }
}
