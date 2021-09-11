import { BigInt, store, log, ethereum } from "@graphprotocol/graph-ts"
import {
  Trading,
  AddMargin,
  ClosePosition,
  NewPosition,
  NewPositionSettled,
  OwnerUpdated,
  PositionLiquidated,
  ProductAdded,
  ProductUpdated,
  ProtocolFeeUpdated,
  Redeemed,
  Staked,
  VaultUpdated
} from "../generated/Trading/Trading"
import { Vault, Product, Position, Trade, VaultDayData } from "../generated/schema"

/*
Todos:
- more product details
- liquidation price for positions
- user stakes listing
- integrate in client
*/

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

export const ZERO_BI = BigInt.fromI32(0)
export const ONE_BI = BigInt.fromI32(1)
export const UNIT_BI = BigInt.fromI32(100000000);

function getVaultDayData(event: ethereum.Event): VaultDayData {

  let timestamp = event.block.timestamp.toI32();
  let day_id = timestamp / 86400;
  let vaultDayData = VaultDayData.load(day_id.toString())

  if (vaultDayData == null) {
    vaultDayData = new VaultDayData(day_id.toString())
    vaultDayData.date = BigInt.fromI32(day_id * 86400)
    vaultDayData.cumulativeVolume = ZERO_BI
    vaultDayData.cumulativeMargin = ZERO_BI
    vaultDayData.positionCount = ZERO_BI
    vaultDayData.tradeCount = ZERO_BI
    vaultDayData.save()
  }

  return vaultDayData!;

}

export function handleAddMargin(event: AddMargin): void {

  let position = Position.load(event.params.positionId.toString())

  if (position) {

    position.margin = event.params.newMargin
    position.leverage = event.params.newLeverage

    position.updatedAtTimestamp = event.block.timestamp
    position.updatedAtBlockNumber = event.block.number

    // volume updates

    let vault = Vault.load((1).toString())
    vault.cumulativeMargin = vault.cumulativeMargin.plus(event.params.margin)

    let vaultDayData = getVaultDayData(event)
    vaultDayData.cumulativeMargin = vaultDayData.cumulativeMargin.plus(event.params.margin)

    let product = Product.load((position.productId).toString())
    product.cumulativeMargin = product.cumulativeMargin.plus(event.params.margin)

    position.save()
    vault.save()
    vaultDayData.save()
    product.save()

  }

  // remove
  //store.remove('ExampleEntity', id);

  // log
  //log.info('log here {},{}', [value1,value2]);

  // Note: If a handler doesn't require existing field values, it is faster
  // _not_ to load the entity from the store. Instead, create it fresh with
  // `new Entity(...)`, set the fields that should be updated and save the
  // entity back to the store. Fields that were not set or unset remain
  // unchanged, allowing for partial updates to be applied.

  // It is also possible to access smart contracts from mappings. For
  // example, the contract that has emitted the event can be connected to
  // with:
  //
  // let contract = Contract.bind(event.address)
  //
  // The following functions can then be called on this contract to access
  // state variables and other data:
  //
  // - contract.MIN_MARGIN(...)
  // - contract.canSettlePositions(...)
  // - contract.getLatestPrice(...)
  // - contract.getPositions(...)
  // - contract.getProduct(...)
  // - contract.getStakes(...)
  // - contract.getVault(...)
  // - contract.nextPositionId(...)
  // - contract.nextStakeId(...)
  // - contract.owner(...)
  // - contract.protocolFee(...)
}

export function handleClosePosition(event: ClosePosition): void {

  let position = Position.load(event.params.positionId.toString())

  if (position) {

    let vault = Vault.load((1).toString())
    let vaultDayData = getVaultDayData(event)
    let product = Product.load((event.params.productId).toString())

    vault.tradeCount = vault.tradeCount.plus(ONE_BI)

    let amount = event.params.margin.times(event.params.leverage).div(UNIT_BI)

    // create new trade
    let trade = new Trade(vault.tradeCount.toString())
    trade.txHash = event.transaction.hash.toHexString()
    
    trade.positionId = event.params.positionId
    trade.productId = event.params.productId
    trade.leverage = event.params.leverage

    trade.amount = amount
    
    trade.entryPrice = event.params.entryPrice
    trade.closePrice = event.params.price

    trade.margin = event.params.margin
    trade.owner = event.params.user

    trade.pnl = event.params.pnl
    trade.pnlIsNegative = event.params.pnlIsNegative
    trade.wasLiquidated = event.params.wasLiquidated
    trade.isFullClose = event.params.isFullClose

    trade.isLong = position.isLong

    trade.timestamp = event.block.timestamp
    trade.blockNumber = event.block.number

    // Update position

    if (event.params.isFullClose) {
      store.remove('Position', event.params.positionId.toString())
      vault.positionCount = vault.positionCount.minus(ONE_BI)
      product.positionCount = product.positionCount.minus(ONE_BI)
    } else {
      // Update position with partial close, e.g. subtract margin
      position.margin = position.margin.minus(event.params.margin)
      position.amount = position.amount.minus(amount)
      position.save()
    }

    // update volumes

    vault.cumulativeVolume = vault.cumulativeVolume.plus(amount)
    vault.cumulativeMargin = vault.cumulativeMargin.plus(event.params.margin)

    if (trade.pnlIsNegative) {
      vault.cumulativePnl = vault.cumulativePnl.minus(event.params.pnl)
      vault.balance = vault.balance.plus(event.params.pnl)
      vaultDayData.cumulativePnl = vaultDayData.cumulativePnl.minus(event.params.pnl)
      product.cumulativePnl = product.cumulativePnl.minus(event.params.pnl)
    } else {
      vault.cumulativePnl = vault.cumulativePnl.plus(event.params.pnl)
      vault.balance = vault.balance.minus(event.params.pnl)
      vaultDayData.cumulativePnl = vaultDayData.cumulativePnl.plus(event.params.pnl)
      product.cumulativePnl = product.cumulativePnl.plus(event.params.pnl)
    }

    vaultDayData.cumulativeVolume = vaultDayData.cumulativeVolume.plus(amount)
    vaultDayData.cumulativeMargin = vaultDayData.cumulativeMargin.plus(event.params.margin)
    vaultDayData.tradeCount = vaultDayData.tradeCount.plus(ONE_BI)

    product.cumulativeVolume = product.cumulativeVolume.plus(amount)
    product.cumulativeMargin = product.cumulativeMargin.plus(event.params.margin)
    product.tradeCount = product.tradeCount.plus(ONE_BI)

    vault.save()
    vaultDayData.save()
    product.save()

  }

}

export function handleNewPosition(event: NewPosition): void {

  let position = Position.load(event.params.positionId.toString())

  if (position == null) {

    // Create position
    position = new Position(event.params.positionId.toString())

    position.productId = event.params.productId
    position.leverage = event.params.leverage
    position.price = event.params.price
    position.margin = event.params.margin

    let amount = event.params.margin.times(event.params.leverage).div(UNIT_BI)
    position.amount = amount

    position.owner = event.params.user

    position.isLong = event.params.isLong
    position.isSettling = true

    position.createdAtTimestamp = event.block.timestamp
    position.createdAtBlockNumber = event.block.number

    // volume updates
    let vault = Vault.load((1).toString())
    vault.cumulativeVolume = vault.cumulativeVolume.plus(amount)
    vault.cumulativeMargin = vault.cumulativeMargin.plus(event.params.margin)
    vault.positionCount = vault.positionCount.plus(ONE_BI)

    let vaultDayData = getVaultDayData(event)
    vaultDayData.cumulativeVolume = vaultDayData.cumulativeVolume.plus(amount)
    vaultDayData.cumulativeMargin = vaultDayData.cumulativeMargin.plus(event.params.margin)
    vaultDayData.positionCount = vaultDayData.positionCount.plus(ONE_BI)

    let product = Product.load((event.params.productId).toString())
    product.cumulativeVolume = product.cumulativeVolume.plus(amount)
    product.cumulativeMargin = product.cumulativeMargin.plus(event.params.margin)
    product.positionCount = product.positionCount.plus(ONE_BI)

    position.save()
    vault.save()
    vaultDayData.save()
    product.save()

  }

}

export function handleNewPositionSettled(event: NewPositionSettled): void {

  let position = Position.load(event.params.positionId.toString())

  if (position) {

    position.price = event.params.price
    position.isSettling = false

    position.settledAtTimestamp = event.block.timestamp
    position.settledAtBlockNumber = event.block.number

    position.save()

  }

}

export function handleProductAdded(event: ProductAdded): void {

  let product = Product.load(event.params.productId.toString())

  if (product == null) {

    product = new Product(event.params.productId.toString())

    product.createdAtTimestamp = event.block.timestamp
    product.createdAtBlockNumber = event.block.number
    
    product.cumulativePnl = ZERO_BI
    product.cumulativeVolume = ZERO_BI
    product.cumulativeMargin = ZERO_BI

    product.positionCount = ZERO_BI
    product.tradeCount = ZERO_BI

  }

  product.save()

}

export function handleProductUpdated(event: ProductUpdated): void {

  let product = Product.load(event.params.productId.toString())

  if (product) {
    product.updatedAtTimestamp = event.block.timestamp
    product.updatedAtBlockNumber = event.block.number
  }

  product.save()

}

export function handleRedeemed(event: Redeemed): void {

  let vault = Vault.load((1).toString())

  if (vault) {

    vault.balance = vault.balance.minus(event.params.amount)
    vault.staked = vault.staked.minus(event.params.amount)

    vault.save()
    
  }

}

export function handleStaked(event: Staked): void {

  let vault = Vault.load((1).toString())

  if (vault) {

    vault.balance = vault.balance.plus(event.params.amount)
    vault.staked = vault.staked.plus(event.params.amount)

    vault.save()

  }

}

export function handleVaultUpdated(event: VaultUpdated): void {

  let vault = Vault.load((1).toString())

  if (vault == null) {

    vault = new Vault((1).toString())

    vault.createdAtTimestamp = event.block.timestamp
    vault.createdAtBlockNumber = event.block.number

    vault.balance = ZERO_BI
    vault.staked = ZERO_BI
    
    vault.cumulativePnl = ZERO_BI
    vault.cumulativeVolume = ZERO_BI
    vault.cumulativeMargin = ZERO_BI

    vault.positionCount = ZERO_BI
    vault.tradeCount = ZERO_BI

  }

  vault.updatedAtTimestamp = event.block.timestamp
  vault.updatedAtBlockNumber = event.block.number

  vault.cap = event.params.vault.cap

  vault.stakingPeriod = event.params.vault.stakingPeriod
  vault.redemptionPeriod = event.params.vault.redemptionPeriod

  vault.maxDailyDrawdown = event.params.vault.maxDailyDrawdown

  vault.save()

}

export function handleOwnerUpdated(event: OwnerUpdated): void {}
export function handleProtocolFeeUpdated(event: ProtocolFeeUpdated): void {}
export function handlePositionLiquidated(event: PositionLiquidated): void {}