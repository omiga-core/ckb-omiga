import { addressToScript, serializeWitnessArgs } from '@nervosnetwork/ckb-sdk-utils'
import { FEE, getJoyIDCellDep } from '../constants'
import { Hex, TransferCKBParams, TransferCKBResult } from '../types'
import { calcMinChangeCapacity, calculateTransactionFee, calculateTransferCkbTxFee } from './helper'
import { CapacityNotEnoughException } from '../exceptions'

export const buildTransferCKBTx = async ({
  collector,
  cellDeps,
  joyID,
  address,
  toAddress,
  amount,
  feeRate,
}: TransferCKBParams): Promise<TransferCKBResult> => {
  let txFee = feeRate ? calculateTransactionFee(feeRate) : FEE
  const isMainnet = address.startsWith('ckb')

  const fromLock = addressToScript(address)
  const minChangeCapacity = calcMinChangeCapacity(fromLock)
  const minChangeBytes = minChangeCapacity / BigInt(10000_0000)

  const toLock = addressToScript(toAddress)

  let inputs: CKBComponents.CellInput[] = []
  let outputs: CKBComponents.CellOutput[] = []
  let outputsData: Hex[] = []
  cellDeps = [...cellDeps]
  if (joyID) {
    cellDeps.push(getJoyIDCellDep(isMainnet))
  }
  let totalInputCapacity = BigInt(0)

  const cells = await collector.getCells({ lock: fromLock })
  if (cells === undefined || cells.length === 0) {
    throw new Error('The from address has no live cells')
  }

  // transfer all ckb
  if (amount === undefined) {
    const { inputs: feeInputs, capacity: inputCapacity } = collector.collectAllInputs(cells)
    inputs = feeInputs

    amount = inputCapacity

    const actualTxFee = calculateTransferCkbTxFee(inputs.length, Number(minChangeBytes), feeRate)
    outputs.push({
      capacity: `0x${(amount - actualTxFee).toString(16)}`,
      lock: toLock,
    })
    outputsData.push('0x')
  } else {
    const { inputs: feeInputs, capacity: inputCapacity } = collector.collectInputs(
      cells,
      amount,
      minChangeCapacity,
      txFee,
    )

    totalInputCapacity = inputCapacity
    inputs.push(...feeInputs)

    txFee = calculateTransferCkbTxFee(inputs.length, Number(minChangeBytes), feeRate)

    let changeCapacity = totalInputCapacity - amount - txFee

    if (changeCapacity !== BigInt(0)) {
      if (changeCapacity <= minChangeCapacity) {
        const { inputs: feeInputs, capacity: inputCapacity } = collector.collectInputs(
          cells,
          amount!,
          minChangeCapacity,
          txFee,
        )
        inputs = feeInputs
        totalInputCapacity = inputCapacity

        changeCapacity = totalInputCapacity - amount - txFee

        if (changeCapacity <= minChangeCapacity) {
          throw new CapacityNotEnoughException(
            `Capacity not enough for change, need ${(txFee + amount + minChangeCapacity).toString(10)}`,
          )
        }
      }

      const changeOutput: CKBComponents.CellOutput = {
        capacity: `0x${changeCapacity.toString(16)}`,
        lock: fromLock,
      }
      outputs.push(changeOutput)
      outputsData.push('0x')
    }

    outputs.push({
      capacity: `0x${amount.toString(16)}`,
      lock: toLock,
    })
    outputsData.push('0x')
  }

  const emptyWitness = { lock: '', inputType: '', outputType: '' }
  const rawTx: CKBComponents.RawTransaction = {
    version: '0x0',
    cellDeps,
    headerDeps: [],
    inputs,
    outputs,
    outputsData,
    witnesses: inputs.map((_, i) => (i > 0 ? '0x' : serializeWitnessArgs(emptyWitness))),
  }

  return { rawTx, txFee, amount }
}
