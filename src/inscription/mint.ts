import {
  addressToScript,
  blake160,
  hexToBytes,
  serializeScript,
  serializeWitnessArgs,
} from '@nervosnetwork/ckb-sdk-utils'
import {
  FEE,
  MIN_CAPACITY,
  getJoyIDCellDep,
  getXudtDep,
  getInscriptionDep,
  getCotaTypeScript,
  getInscriptionInfoTypeScript,
  getXinsDep,
} from '../constants'
import { Address, Hex, MintParams, MintResult, SubkeyUnlockReq } from '../types'
import {
  calcXudtTypeScript,
  calcMintXudtWitness,
  calculateTransactionFee,
  calcXinsTypeScript,
  calcMinChangeCapacity,
  calcXudtCapacity,
  calcMintXinsWitness,
} from './helper'
import { append0x, u128ToLe } from '../utils'
import {
  CapacityNotEnoughException,
  InscriptionInfoException,
  NoCotaCellException,
  NoLiveCellException,
} from '../exceptions'

export const buildMintXudtTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  inscriptionId,
  mintLimit,
  feeRate,
}: MintParams): Promise<MintResult> => {
  const isMainnet = address.startsWith('ckb')
  const txFee = feeRate ? calculateTransactionFee(feeRate) : FEE

  const fromLock = addressToScript(address)
  const fromXudtCapacity = calcXudtCapacity(fromLock, false)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getXudtDep(isMainnet), getInscriptionDep(isMainnet)]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }

  const cells = await collector.getCells({ lock: fromLock })
  if (!cells || cells.length === 0) {
    throw new NoLiveCellException('The address has no live cells')
  }

  const { inputs: feeInputs, capacity: feeInputCapacity } = collector.collectInputs(
    cells,
    fromXudtCapacity,
    minChangeCapacity,
    txFee,
  )

  inputs.push(...feeInputs)

  let totalInputCapacity = feeInputCapacity
  let totalOutputCapacity = fromXudtCapacity

  const infoType: CKBComponents.Script = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: append0x(inscriptionId),
  }

  const inscriptionInfoCells = await collector.getCells({ type: infoType })
  if (!inscriptionInfoCells || inscriptionInfoCells.length === 0) {
    throw new InscriptionInfoException('There is no inscription info cell with the given inscription id')
  }
  const inscriptionInfoCellDep: CKBComponents.CellDep = {
    outPoint: inscriptionInfoCells[0].outPoint,
    depType: 'code',
  }
  cellDeps.push(inscriptionInfoCellDep)

  const changeCapacity = totalInputCapacity - totalOutputCapacity - txFee
  if (changeCapacity < minChangeCapacity) {
    throw new CapacityNotEnoughException('Not enough capacity for change cell')
  }
  let changeOutput: CKBComponents.CellOutput = {
    capacity: `0x${changeCapacity.toString(16)}`,
    lock: fromLock,
  }
  outputs.push(changeOutput)
  outputsData.push('0x')

  const xudtType = calcXudtTypeScript(infoType, isMainnet)
  let xudtOutput: CKBComponents.CellOutput = {
    capacity: `0x${fromXudtCapacity.toString(16)}`,
    lock: fromLock,
    type: xudtType,
  }

  outputs.push(xudtOutput)
  outputsData.push(append0x(u128ToLe(mintLimit)))

  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  let witnesses = [serializeWitnessArgs(emptyWitness), calcMintXudtWitness(infoType, isMainnet)]
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

  return { rawTx, txFee }
}

export const buildMintXinsTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  inscriptionId,
  mintLimit,
  feeRate,
}: MintParams): Promise<MintResult> => {
  const isMainnet = address.startsWith('ckb')
  const txFee = feeRate ? calculateTransactionFee(feeRate) : FEE

  const fromLock = addressToScript(address)
  const fromXinsCapacity = calcXudtCapacity(fromLock, false)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getXinsDep(isMainnet), getInscriptionDep(isMainnet)]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }

  const cells = await collector.getCells({ lock: fromLock })
  if (!cells || cells.length === 0) {
    throw new NoLiveCellException('The address has no live cells')
  }

  const { inputs: feeInputs, capacity: feeInputCapacity } = collector.collectInputs(
    cells,
    fromXinsCapacity,
    minChangeCapacity,
    txFee,
  )

  inputs.push(...feeInputs)

  let totalInputCapacity = feeInputCapacity
  let totalOutputCapacity = fromXinsCapacity

  const infoType: CKBComponents.Script = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: append0x(inscriptionId),
  }

  const inscriptionInfoCells = await collector.getCells({ type: infoType })
  if (!inscriptionInfoCells || inscriptionInfoCells.length === 0) {
    throw new InscriptionInfoException('There is no inscription info cell with the given inscription id')
  }
  const inscriptionInfoCellDep: CKBComponents.CellDep = {
    outPoint: inscriptionInfoCells[0].outPoint,
    depType: 'code',
  }
  cellDeps.push(inscriptionInfoCellDep)

  const changeCapacity = totalInputCapacity - totalOutputCapacity - txFee
  if (changeCapacity < minChangeCapacity) {
    throw new CapacityNotEnoughException('Not enough capacity for change cell')
  }
  let changeOutput: CKBComponents.CellOutput = {
    capacity: `0x${changeCapacity.toString(16)}`,
    lock: fromLock,
  }
  outputs.push(changeOutput)
  outputsData.push('0x')

  const xinsType = calcXinsTypeScript(infoType, isMainnet)
  let xudtOutput: CKBComponents.CellOutput = {
    capacity: `0x${fromXinsCapacity.toString(16)}`,
    lock: fromLock,
    type: xinsType,
  }

  outputs.push(xudtOutput)
  outputsData.push(append0x(u128ToLe(mintLimit)))

  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  let witnesses = [serializeWitnessArgs(emptyWitness), calcMintXinsWitness(infoType, isMainnet)]
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

  return { rawTx, txFee }
}
