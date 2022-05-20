/* eslint-disable no-unused-expressions */
/* eslint-env mocha */
'use strict'

const { stub, assert } = require('sinon')
const BigNumber = require('bignumber.js')

const PerformanceManager = require('../../../../../../../lib/ws_servers/api/handlers/strategy/performance/PerformanceManager')
const PercentageStopLossWatcher = require('../../../../../../../lib/ws_servers/api/handlers/strategy/performance/PercentageStopLossWatcher')
const PriceFeed = require('../../../../../../../lib/ws_servers/api/handlers/strategy/performance/PriceFeed')

describe('PercentageStopLossWatcher', () => {
  it('should emit stop event', (done) => {
    const priceFeed = new PriceFeed(new BigNumber(1000))
    const pos = new PerformanceManager(priceFeed, {
      maxPositionSize: new BigNumber(10),
      allocation: new BigNumber(1000)
    })
    const watcher = new PercentageStopLossWatcher(pos, {
      stopLoss: new BigNumber(0.2)
    })
    watcher.abortStrategy = stub()

    pos.addOrder({
      amount: new BigNumber(1),
      price: new BigNumber(1000)
    })

    priceFeed.update(new BigNumber(800))

    setImmediate(() => {
      assert.called(watcher.abortStrategy)
      watcher.close()
      done()
    })
  })
})
