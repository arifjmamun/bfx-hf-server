'use strict'

const _isFunction = require('lodash/isFunction')

module.exports = (algos, algoID, marketData, payload) => {
  const ao = algos.find(ao => ao.id === algoID)

  if (!ao) {
    return `Unknown algo order ID: ${algoID}`
  }

  const { meta = {} } = ao
  const { validateParams, processParams } = meta

  if (!_isFunction(validateParams)) {
    return null
  }

  const { _symbol } = payload

  const symbolDetail = marketData.get(_symbol)

  const params = _isFunction(processParams)
    ? processParams(payload)
    : { ...payload }

  const err = validateParams(params, symbolDetail)
  if (err) {
    return err.message
  }

  return null
}
