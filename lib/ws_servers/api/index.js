'use strict'

const { get: getCredentials } = require('../../db/credentials')
const send = require('../../util/ws/send')
const WSServer = require('../../ws_server')
const { CREDENTIALS_CID } = require('../../db/credentials')

const onAuthSubmit = require('./handlers/on_auth_submit')
const onAuthInit = require('./handlers/on_auth_init')
const onAuthReset = require('./handlers/on_auth_reset')
const onActiveAlgoOrdersRequest = require('./handlers/on_active_algo_orders_request')

const onSaveStrategy = require('./handlers/on_save_strategy')
const onRemoveStrategy = require('./handlers/on_remove_strategy')
const onSaveAPICredentials = require('./handlers/on_save_api_credentials')
const onAlgoOrderRemove = require('./handlers/on_algo_order_remove')
const onAlgoOrderLoad = require('./handlers/on_algo_order_load')
const onOrderSubmit = require('./handlers/on_order_submit')
const onOrderCancel = require('./handlers/on_order_cancel')
const onAlgoOrderSubmit = require('./handlers/on_algo_order_submit')
const onAlgoOrderCancel = require('./handlers/on_algo_order_cancel')
const onAlgoPause = require('./handlers/on_algo_pause')
const onSettingsUpdate = require('./handlers/on_settings_update')
const onSettingsRequest = require('./send_settings')
const onSaveFavouriteTradingPairs = require('./handlers/on_save_favourite_trading_pairs')
const onFavouriteTradingPairsRequest = require('./handlers/on_favourite_trading_pairs_request')
const onShowAlgoPauseInfoRequest = require('./handlers/on_algo_pause_info_request')
const onAlgoOrderParamsSave = require('./handlers/algo_order_params/set')
const onAlgoOrderParamsRequest = require('./handlers/algo_order_params/get')
const onAlgoOrderParamsRemove = require('./handlers/algo_order_params/remove')

const onLiveStrategyExecutionStart = require('./handlers/strategy/live_strategy_execution_start')
const onLiveStrategyExecutionStop = require('./handlers/strategy/live_strategy_execution_stop')
const onLiveStrategyExecutionStatus = require('./handlers/strategy/live_strategy_execution_status')

const AlgoWorker = require('./algos/algo_worker')
const { _default: DEFAULT_USER_SETTINGS } = require('bfx-hf-ui-config').UserSettings
const algoHost = require('bfx-hf-algo')

const StrategyManager = require('./handlers/strategy/strategy_manager')

const VERSION = 1

module.exports = class APIWSServer extends WSServer {
  constructor ({
    port,
    server,
    db,
    algoDB,
    restURL,
    wsURL,
    algos,
    logAlgoOpts,
    config
  }) {
    super({
      port,
      server,
      debugName: 'api',
      msgHandlers: {
        'auth.init': onAuthInit,
        'auth.submit': onAuthSubmit,
        'auth.reset': onAuthReset,

        'get.settings': onSettingsRequest,
        'get.active_algo_orders': onActiveAlgoOrdersRequest,
        'get.favourite_trading_pairs': onFavouriteTradingPairsRequest,
        'get.show_algo_pause_info': onShowAlgoPauseInfoRequest,

        'algo_order_params.save': onAlgoOrderParamsSave,
        'algo_order_params.get': onAlgoOrderParamsRequest,
        'algo_order_params.remove': onAlgoOrderParamsRemove,

        'strategy.execute_start': onLiveStrategyExecutionStart,
        'strategy.execute_stop': onLiveStrategyExecutionStop,
        'strategy.execute_status': onLiveStrategyExecutionStatus,

        'strategy.save': onSaveStrategy,
        'strategy.remove': onRemoveStrategy,
        'api_credentials.save': onSaveAPICredentials,
        'order.submit': onOrderSubmit,
        'order.cancel': onOrderCancel,
        'algo_order.submit': onAlgoOrderSubmit,
        'algo_order.load': onAlgoOrderLoad,
        'algo_order.cancel': onAlgoOrderCancel,
        'algo_order.remove': onAlgoOrderRemove,
        'algo_order.pause': onAlgoPause,
        'settings.update': onSettingsUpdate,
        'favourite_trading_pairs.save': onSaveFavouriteTradingPairs
      }
    })

    this.db = db
    this.algoDB = algoDB

    this.wsURL = wsURL
    this.restURL = restURL

    this.algos = this.loadAlgos(algos)

    this.logAlgoOpts = logAlgoOpts
    this.config = config

    this.reconnectAlgoHost = this.reconnectAlgoHost.bind(this)
  }

  setMarketData (marketData) {
    this.marketData = marketData
  }

  loadAlgos (algos) {
    return algos.map((el) => algoHost[el])
  }

  async reconnectAlgoHost (ws) {
    const { dms } = await this.getUserSettings()
    ws.algoWorker.reconnect(dms)
  }

  async sendInitialConnectionData (ws) {
    const { Credential } = this.db

    send(ws, ['info.version', VERSION])
    send(ws, ['info.exchanges', ['bitfinex']])

    const [oldAccount] = await Credential.find([
      ['cid', '!=', CREDENTIALS_CID],
      ['mode', '!=', 'paper'],
      ['mode', '!=', 'main']
    ])

    if (oldAccount) {
      oldAccount.mode = 'main'
      await Credential.set(oldAccount)
    }

    const modes = await Credential.find([['cid', '!=', CREDENTIALS_CID]])
    const configuredModes = modes.map((el) => {
      return el.mode
    })

    send(ws, ['info.modes_configured', configuredModes])

    await this.migrateFavs()

    const credentials = await getCredentials(this.db)
    send(ws, ['info.auth_configured', !!credentials])
  }

  async migrateFavs () {
    const { FavouriteTradingPairs } = this.db
    const old = await FavouriteTradingPairs.get('favouriteTradingPairs')

    if (!old) {
      return
    }

    if (!old.pairs || old.pairs.length === 0) {
      return
    }

    const n = await FavouriteTradingPairs.get('main')
    if (n && n.pairs) {
      return
    }

    this.d('old database found... migrating old favs database...')

    await FavouriteTradingPairs.set({ main: 'main', pairs: old.pairs })
  }

  async onWSSConnection (ws) {
    super.onWSSConnection(ws)

    ws.clients = {}
    ws.user = null

    const { dms, affiliateCode } = await this.getUserSettings()
    ws.algoWorker = new AlgoWorker(
      { dms, affiliateCode, wsURL: this.wsURL, restURL: this.restURL },
      this.algos,
      { ws: send.bind(send, ws) },
      this.algoDB,
      this.logAlgoOpts,
      this.marketData
    )

    ws.strategyManager = new StrategyManager(
      { dms, wsURL: this.wsURL, restURL: this.restURL }
    )

    await this.sendInitialConnectionData(ws)
  }

  async getUserSettings () {
    const { UserSettings } = this.db
    const { userSettings } = await UserSettings.getAll()

    return { ...DEFAULT_USER_SETTINGS, ...userSettings }
  }

  onWSClose (ws) {
    super.onWSClose(ws)

    Object.keys(ws.clients).forEach(exID => {
      ws.clients[exID].close()
    })

    ws.algoWorker.close()
    ws.strategyManager.close()

    ws.clients = {}
    ws.user = null
  }
}
