import {
  addressToScript,
  blake160,
  scriptToHash,
  serializeScript,
  serializeWitnessArgs,
} from '@nervosnetwork/ckb-sdk-utils'
import {
  FEE,
  getJoyIDCellDep,
  getInscriptionInfoTypeScript,
  getInscriptionInfoDep,
  getCotaTypeScript,
} from '../constants'
import { ActualSupplyParams, Hex, InfoRebaseParams, RebaseInfoResult, SubkeyUnlockReq } from '../types'
import {
  calcActualSupply,
  calcRebasedXudtHash,
  calcXudtTypeScript,
  setInscriptionInfoRebased,
  calculateTransactionFee,
  calcXinsTypeScript,
  calcMinChangeCapacity,
} from './helper'
import { append0x } from '../utils'
import {
  CapacityNotEnoughException,
  InscriptionInfoException,
  NoCotaCellException,
  NoLiveCellException,
} from '../exceptions'

export const calcInscriptionXudtActualSupply = async ({ collector, inscriptionId, isMainnet }: ActualSupplyParams) => {
  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: append0x(inscriptionId),
  }
  const preXudtType = calcXudtTypeScript(inscriptionInfoType, isMainnet)
  const preXudtCells = await collector.getCells({ type: preXudtType })
  if (!preXudtCells || preXudtCells.length === 0) {
    throw new InscriptionInfoException('Cannot find any previous xudt cell with the given inscription id')
  }
  const actualSupply = calcActualSupply(preXudtCells)
  return actualSupply
}

export const calcInscriptionXinsActualSupply = async ({ collector, inscriptionId, isMainnet }: ActualSupplyParams) => {
  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: append0x(inscriptionId),
  }
  const preXinsType = calcXinsTypeScript(inscriptionInfoType, isMainnet)
  const preXinsCells = await collector.getCells({ type: preXinsType })
  if (!preXinsCells || preXinsCells.length === 0) {
    throw new InscriptionInfoException('Cannot find any previous xudt cell with the given inscription id')
  }
  const actualSupply = calcActualSupply(preXinsCells)
  return actualSupply
}

export const buildXudtInfoRebaseTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  inscriptionId,
  actualSupply,
  feeRate,
}: InfoRebaseParams): Promise<RebaseInfoResult> => {
  const isMainnet = address.startsWith('ckb')
  const txFee = feeRate ? calculateTransactionFee(feeRate) : FEE
  const fromLock = addressToScript(address)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getInscriptionInfoDep(isMainnet)]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: append0x(inscriptionId),
  }

  const inscriptionInfoCells = await collector.getCells({ type: inscriptionInfoType })
  if (!inscriptionInfoCells || inscriptionInfoCells.length === 0) {
    throw new InscriptionInfoException('There is no inscription info cell with the given inscription id')
  }

  const infoInput: CKBComponents.CellInput = {
    previousOutput: inscriptionInfoCells[0].outPoint,
    since: '0x0',
  }
  inputs.push(infoInput)

  const preXudtHash = scriptToHash(calcXudtTypeScript(inscriptionInfoType, isMainnet))
  const rebasedXudtHash = calcRebasedXudtHash(inscriptionInfoType, preXudtHash, actualSupply, isMainnet)
  const inscriptionInfo = setInscriptionInfoRebased(inscriptionInfoCells[0].outputData, rebasedXudtHash)

  let inputCapacity = BigInt(append0x(inscriptionInfoCells[0].output.capacity))
  const outputCapacity = inputCapacity
  const infoOutput: CKBComponents.CellOutput = {
    ...inscriptionInfoCells[0].output,
    capacity: `0x${outputCapacity.toString(16)}`,
  }
  outputs.push(infoOutput)
  outputsData.push(inscriptionInfo)

  const cells = await collector.getCells({ lock: fromLock })
  if (!cells || cells.length === 0) {
    throw new NoLiveCellException('The address has no live cells')
  }
  const { inputs: feeInputs, capacity: feeInputCapacity } = collector.collectInputs(
    cells,
    BigInt(0),
    minChangeCapacity,
    txFee,
  )

  inputs.push(...feeInputs)
  inputCapacity += feeInputCapacity

  const changeCapacity = inputCapacity - outputCapacity - txFee
  if (changeCapacity < minChangeCapacity) {
    throw new CapacityNotEnoughException('Not enough capacity for change cell')
  }
  outputs.push({
    capacity: `0x${changeCapacity.toString(16)}`,
    lock: fromLock,
  })
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

  return { rawTx, txFee }
}

export const buildXinsInfoRebaseTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  inscriptionId,
  actualSupply,
  feeRate,
}: InfoRebaseParams): Promise<RebaseInfoResult> => {
  const isMainnet = address.startsWith('ckb')
  const txFee = feeRate ? calculateTransactionFee(feeRate) : FEE
  const fromLock = addressToScript(address)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getInscriptionInfoDep(isMainnet)]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: append0x(inscriptionId),
  }

  const inscriptionInfoCells = await collector.getCells({ type: inscriptionInfoType })
  if (!inscriptionInfoCells || inscriptionInfoCells.length === 0) {
    throw new InscriptionInfoException('There is no inscription info cell with the given inscription id')
  }

  const infoInput: CKBComponents.CellInput = {
    previousOutput: inscriptionInfoCells[0].outPoint,
    since: '0x0',
  }
  inputs.push(infoInput)

  const preXinsHash = scriptToHash(calcXinsTypeScript(inscriptionInfoType, isMainnet))
  const rebasedXudtHash = calcRebasedXudtHash(inscriptionInfoType, preXinsHash, actualSupply, isMainnet)
  const inscriptionInfo = setInscriptionInfoRebased(inscriptionInfoCells[0].outputData, rebasedXudtHash)

  let inputCapacity = BigInt(append0x(inscriptionInfoCells[0].output.capacity))
  const outputCapacity = inputCapacity
  const infoOutput: CKBComponents.CellOutput = {
    ...inscriptionInfoCells[0].output,
    capacity: `0x${outputCapacity.toString(16)}`,
  }
  outputs.push(infoOutput)
  outputsData.push(inscriptionInfo)

  const cells = await collector.getCells({ lock: fromLock })
  if (!cells || cells.length === 0) {
    throw new NoLiveCellException('The address has no live cells')
  }
  const { inputs: feeInputs, capacity: feeInputCapacity } = collector.collectInputs(
    cells,
    BigInt(0),
    minChangeCapacity,
    txFee,
  )

  inputs.push(...feeInputs)
  inputCapacity += feeInputCapacity

  const changeCapacity = inputCapacity - outputCapacity - txFee
  if (changeCapacity < minChangeCapacity) {
    throw new CapacityNotEnoughException('Not enough capacity for change cell')
  }
  outputs.push({
    capacity: `0x${changeCapacity.toString(16)}`,
    lock: fromLock,
  })
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

  return { rawTx, txFee }
}
