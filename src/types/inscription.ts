import { Byte32, Capacity, Hex, U128, U8 } from './common'
import { Collector } from '../collector'
import { Address } from '../types'
import { ConnectResponseData } from '@joyid/ckb'
import { Aggregator } from '../aggregator'

export interface InscriptionXinsInfo {
  decimal: U8
  name: string
  symbol: string
  xinsHash: Byte32
  maxSupply: U128
  mintLimit: U128
  mintStatus: U8
}

export interface InscriptionXudtInfo {
  decimal: U8
  name: string
  symbol: string
  xudtHash: Byte32
  maxSupply: U128
  mintLimit: U128
  mintStatus: U8
}

export interface JoyIDConfig {
  aggregator: Aggregator
  connectData: ConnectResponseData
}

interface BaseParams {
  collector: Collector
  joyID?: JoyIDConfig
  cellDeps: CKBComponents.CellDep[]
  address: Address
  feeRate?: bigint
}

export interface DeployParams extends BaseParams {
  info: InscriptionXudtInfo
}

export interface DeployXinsParams extends BaseParams {
  info: InscriptionXinsInfo
}

export interface DeployResult {
  rawTx: CKBComponents.RawTransaction
  inscriptionId: Hex
  xudtHash: Byte32
}

export interface DeployXinsResult {
  rawTx: CKBComponents.RawTransaction
  inscriptionId: Hex
  xinsHash: Byte32
}

export interface MintParams extends BaseParams {
  inscriptionId: Byte32
  mintLimit: bigint
}

export interface CloseParams extends BaseParams {
  inscriptionId: Byte32
}

export interface ActualSupplyParams {
  collector: Collector
  inscriptionId: string
  isMainnet: boolean
}

export interface InfoRebaseParams extends BaseParams {
  inscriptionId: Byte32
  actualSupply: bigint
}

export interface RebaseMintXudtParams extends BaseParams {
  inscriptionXudtInfo: InscriptionXudtInfo
  inscriptionId: Byte32
  actualSupply: bigint
  cellCount?: number
}

export interface RebaseMintXinsParams extends BaseParams {
  inscriptionXinsInfo: InscriptionXinsInfo
  inscriptionId: Byte32
  actualSupply: bigint
  cellCount?: number
}

export interface TransferXudtResult {
  rawTx: CKBComponents.RawTransaction
  packagedCkb: bigint
  amount: bigint
}

export interface MergeXudtResult {
  rawTx: CKBComponents.RawTransaction
  freedCkb: bigint
  remain: boolean
}

export interface EstimateMergeXudtResult {
  freedCkb: bigint
  remain: boolean
}

export interface TransferXinsResult {
  rawTx: CKBComponents.RawTransaction
  packagedCkb: bigint
  amount: bigint
}

export interface RebaseMintResult {
  rawTx: CKBComponents.RawTransaction
  rebasedXudtType: CKBComponents.Script
}

export interface MergeXudtParams extends BaseParams {
  xudtType: CKBComponents.Script
  cellCount?: number
}

export interface DestroyXudtParams extends BaseParams {
  xudtType: CKBComponents.Script
  cellCount?: number
}

export interface DestroyXinsParams extends BaseParams {
  xinsType: CKBComponents.Script
  cellCount?: number
}

export interface TransferXudtParams extends BaseParams {
  xudtType: CKBComponents.Script
  toAddress: Address
  transferAmount?: bigint
}

export interface TransferXinsParams extends BaseParams {
  xinsType: CKBComponents.Script
  toAddress: Address
  cellCount?: number
}

export interface TransferCKBParams extends BaseParams {
  toAddress: Address
  amount?: Capacity
}

export interface RebasedTransferParams extends BaseParams {
  rebasedXudtType: CKBComponents.Script
  toAddress: Address
  cellCount?: number
}
