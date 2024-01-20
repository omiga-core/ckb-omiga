import { addressToScript, blake160, serializeScript, serializeWitnessArgs } from '@nervosnetwork/ckb-sdk-utils'
import {
  FEE,
  getJoyIDCellDep,
  getInscriptionInfoTypeScript,
  getInscriptionInfoDep,
  getCotaTypeScript,
} from '../constants'
import { CloseParams, Hex, SubkeyUnlockReq } from '../types'
import { calcMinChangeCapacity, calculateTransactionFee, setInscriptionInfoClosed } from './helper'
import { append0x } from '../utils'
import {
  CapacityNotEnoughException,
  InscriptionInfoException,
  NoCotaCellException,
  NoLiveCellException,
} from '../exceptions'

export const buildCloseTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  inscriptionId,
  feeRate,
}: CloseParams): Promise<CKBComponents.RawTransaction> => {
  const txFee = feeRate ? calculateTransactionFee(feeRate) : FEE
  const isMainnet = address.startsWith('ckb')
  const fromLock = addressToScript(address)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)

  const inscriptionInfoType = {
    ...getInscriptionInfoTypeScript(isMainnet),
    args: append0x(inscriptionId),
  }

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps, getInscriptionInfoDep(isMainnet)]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }

  const inscriptionInfoCells = await collector.getCells({ lock: fromLock, type: inscriptionInfoType })
  if (!inscriptionInfoCells || inscriptionInfoCells.length === 0) {
    throw new InscriptionInfoException('The address has no inscription info cells')
  }
  let infoInput: CKBComponents.CellInput = {
    previousOutput: inscriptionInfoCells[0].outPoint,
    since: '0x0',
  }
  inputs.push(infoInput)

  let inputCapacity = BigInt(append0x(inscriptionInfoCells[0].output.capacity))
  const outputCapacity = inputCapacity
  const inscriptionInfo = setInscriptionInfoClosed(inscriptionInfoCells[0].outputData)
  let infoOutput: CKBComponents.CellOutput = {
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

  return rawTx
}
