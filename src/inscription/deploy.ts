import {
  addressToScript,
  blake160,
  hexToBytes,
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
import { Address, Hex, SubkeyUnlockReq } from '../types'
import {
  DeployParams,
  DeployXinsParams,
  DeployResult,
  DeployXinsResult,
  InscriptionXudtInfo,
  InscriptionXinsInfo,
} from '../types/inscription'
import {
  calcInscriptionInfoSize,
  calcMinChangeCapacity,
  calcXudtHash,
  calculateTransactionFee,
  generateInscriptionId,
  serializeInscriptionXudtInfo,
  serializeInscriptionXinsInfo,
  calcXinsHash,
} from './helper'
import { append0x } from '../utils'
import { CapacityNotEnoughException, NoCotaCellException, NoLiveCellException } from '../exceptions'

// include lock, inscription info type
export const calcInscriptionInfoCapacity = (address: Address, info: InscriptionXudtInfo | InscriptionXinsInfo) => {
  const lock = addressToScript(address)
  const argsSize = hexToBytes(lock.args).length
  const lockSize = 32 + 1 + argsSize
  const inscriptionInfoTypeSize = 32 + 32 + 1
  const capacitySize = 8
  const infoDataSize = calcInscriptionInfoSize(info)
  const cellSize = lockSize + inscriptionInfoTypeSize + capacitySize + infoDataSize
  return BigInt(cellSize) * BigInt(10000_0000)
}

export const buildDeployTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  info,
  feeRate,
}: DeployParams): Promise<DeployResult> => {
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

  const cells = await collector.getCells({ lock: fromLock })
  if (!cells || cells.length === 0) {
    throw new NoLiveCellException('The address has no live cells')
  }

  const infoCapacity = calcInscriptionInfoCapacity(address, info)
  const outputCapacity = infoCapacity

  const { inputs: feeInputs, capacity: inputCapacity } = collector.collectInputs(
    cells,
    outputCapacity,
    minChangeCapacity,
    txFee,
  )
  inputs.push(...feeInputs)

  const inscriptionId = generateInscriptionId(inputs[0], 0)

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: inscriptionId,
  }

  const newXudtInfo: InscriptionXudtInfo = {
    ...info,
    xudtHash: calcXudtHash(inscriptionInfoType, isMainnet),
  }
  const inscriptionXudtInfo = append0x(serializeInscriptionXudtInfo(newXudtInfo))

  let infoOutput = {
    capacity: `0x${infoCapacity.toString(16)}`,
    lock: fromLock,
    type: inscriptionInfoType,
  }
  outputs.push(infoOutput)
  outputsData.push(inscriptionXudtInfo)

  if (inputCapacity - outputCapacity - txFee !== BigInt(0)) {
    const changeCapacity = inputCapacity - infoCapacity - txFee
    if (changeCapacity < minChangeCapacity) {
      throw new CapacityNotEnoughException('Not enough capacity for change cell')
    }
    outputs.push({
      capacity: `0x${changeCapacity.toString(16)}`,
      lock: fromLock,
    })
    outputsData.push('0x')
  }

  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  let witnesses = [serializeWitnessArgs(emptyWitness), '0x']
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

  return { rawTx, inscriptionId, xudtHash: newXudtInfo.xudtHash }
}

export const buildDeployXinsTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  info,
  feeRate,
}: DeployXinsParams): Promise<DeployXinsResult> => {
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

  const infoCapacity = calcInscriptionInfoCapacity(address, info)
  const outputCapacity = infoCapacity

  const cells = await collector.getCells({ lock: fromLock })
  if (!cells || cells.length === 0) {
    throw new NoLiveCellException('The address has no live cells')
  }

  const { inputs: feeInputs, capacity: inputCapacity } = collector.collectInputs(
    cells,
    outputCapacity,
    minChangeCapacity,
    txFee,
  )
  inputs.push(...feeInputs)

  const inscriptionId = generateInscriptionId(inputs[0], 0)

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: inscriptionId,
  }

  const newXinsInfo: InscriptionXinsInfo = {
    ...info,
    xinsHash: calcXinsHash(inscriptionInfoType, isMainnet),
  }
  const inscriptionInfo = append0x(serializeInscriptionXinsInfo(newXinsInfo))

  let infoOutput = {
    capacity: `0x${infoCapacity.toString(16)}`,
    lock: fromLock,
    type: inscriptionInfoType,
  }
  outputs.push(infoOutput)
  outputsData.push(inscriptionInfo)

  if (inputCapacity - outputCapacity - txFee !== BigInt(0)) {
    const changeCapacity = inputCapacity - infoCapacity - txFee
    if (changeCapacity < minChangeCapacity) {
      throw new CapacityNotEnoughException('Not enough capacity for change cell')
    }
    outputs.push({
      capacity: `0x${changeCapacity.toString(16)}`,
      lock: fromLock,
    })
    outputsData.push('0x')
  }

  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  let witnesses = [serializeWitnessArgs(emptyWitness), '0x']
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

  return { rawTx, inscriptionId, xinsHash: newXinsInfo.xinsHash }
}
