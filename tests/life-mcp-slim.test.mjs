import assert from 'node:assert/strict'
import test from 'node:test'

const {
  compactLuckinAttrs,
  compactMcdMenu,
  formatToolCallResult,
  pruneJson,
  slimLuckinPayload,
  slimMcdPayload,
  slimToolList,
  unwrapToolCall,
} = await import('../supabase/functions/hamster-life-mcp/slim.ts')

// Shaped like a real Luckin tools/call reply: JSON-RPC envelope, payload
// escaped a second time inside content[0].text.
const rpc = (payload, isError = false) => ({
  jsonrpc: '2.0',
  id: 2,
  result: { content: [{ type: 'text', text: JSON.stringify(payload) }], isError },
})

const attr = (id, name, options) => ({
  attributeId: id,
  attributeName: name,
  productSubAttrs: options.map(([subId, subName, selected, price = 0]) => ({
    attributeId: subId, attributeName: subName, selected, price, canSelected: selected === null ? null : 1,
  })),
})

test('unwrapToolCall parses the double-escaped text payload and reports errors', () => {
  assert.deepEqual(unwrapToolCall(rpc({ code: 0 })), { payload: { code: 0 }, isError: false })
  assert.deepEqual(unwrapToolCall(rpc('库存不足', true)), { payload: '库存不足', isError: true })
  const rpcError = { code: -32602, message: 'bad params', data: { field: 'deptId' } }
  assert.deepEqual(unwrapToolCall({ jsonrpc: '2.0', id: 2, error: rpcError }), { payload: rpcError, isError: true })
  assert.equal(formatToolCallResult({ jsonrpc: '2.0', id: 2, error: rpcError }, (payload) => payload),
    'Error: {"code":-32602,"message":"bad params","data":{"field":"deptId"}}')
  const plain = { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '门店已打烊' }] } }
  assert.equal(formatToolCallResult(plain), '门店已打烊')
})

test('pruneJson drops nulls, empties and image URLs at every depth', () => {
  assert.deepEqual(pruneJson({
    a: null, b: '', c: [], d: [null], keep: 0, flag: false,
    pictureUrl: 'https://cdn/x.png', breviaryPicUrl: 'https://cdn/y.png', bigPicUrl: null,
    nested: { iconUrl: 'https://cdn/z.png', image_url: '//cdn/w.png', name: '拿铁' },
    topic: 'https://example.com/a', storeImage: '暂无图片',
  }), { keep: 0, flag: false, nested: { name: '拿铁' }, topic: 'https://example.com/a', storeImage: '暂无图片' })
})

test('compactLuckinAttrs keeps group/option ids, marks the selection and surcharges', () => {
  assert.deepEqual(compactLuckinAttrs([
    attr(64, '杯型', [[365, '大杯', true], [594, '超大杯', false, 3]]),
    attr(17, '温度', [[57, '冰', null]]),
  ]), { '杯型#64': '✓大杯#365 | 超大杯#594+3', '温度#17': '冰#57' })
})

test('slimLuckinPayload: product search keeps ids, sku, prices and compact specs', () => {
  const slim = slimLuckinPayload({
    code: 0, msg: 'success', success: true,
    data: [{
      productId: 1, productName: '测试拿铁', skuCode: 'SP0001-00001', pictureUrl: 'https://cdn/p.png',
      productAttrs: [attr(18, '糖度', [[69, '不另外加糖', null]])],
      tags: null, initialPrice: 20, estimatePrice: 13.9, fallback: false,
    }],
  })
  assert.deepEqual(slim, [{
    productId: 1, productName: '测试拿铁', skuCode: 'SP0001-00001',
    specs: { '糖度#18': '不另外加糖#69' }, initialPrice: 20, estimatePrice: 13.9,
  }])
})

test('slimLuckinPayload: order preview keeps coupons and prices, trims shop and order lines', () => {
  const slim = slimLuckinPayload({
    code: 0, msg: 'success', success: true,
    data: {
      aboutTime: Date.UTC(2026, 9, 10, 1, 16),
      discountPrice: 13.9,
      shopInfo: {
        deptId: 9, deptName: '测试门店', address: '某路 1 号', supportSend: 1, deptTags: [],
        longitude: 104, latitude: 30, workTimeStart: '07:00', number: '(No.0001)', workStatus: '营业中',
      },
      productInfoList: [{
        productId: 1, skuCode: 'SP0001-00001', name: '测试拿铁', amount: 1,
        additionDesc: '大杯/冰/不另外加糖', breviaryPicUrl: 'https://cdn/p.png', bigPicUrl: null,
        productAttrs: [attr(64, '杯型', [[365, '大杯', null]])],
        initPrice: 20, estimatePrice: 13.9, estimateTotalPrice: 13.9,
        picture: null, type: null, productType: 'product', cafeKuIdList: [null], coffeeVoucherType: 0,
      }],
      couponCodeList: ['TESTCOUPON'],
      orderGranularCommodityList: [{ commodityId: 1, payableMoney: 20 }],
      expressExpectTime: null, privilegeMoney: 6.1, totalInitialPrice: 20,
    },
  })
  assert.deepEqual(slim, {
    aboutTime: '2026-10-10 09:16（上海时间）',
    discountPrice: 13.9,
    shopInfo: { deptId: 9, deptName: '测试门店', number: '(No.0001)', workStatus: '营业中' },
    productInfoList: [{
      productId: 1, skuCode: 'SP0001-00001', name: '测试拿铁', amount: 1, additionDesc: '大杯/冰/不另外加糖',
      initPrice: 20, estimatePrice: 13.9, estimateTotalPrice: 13.9,
    }],
    couponCodeList: ['TESTCOUPON'],
    privilegeMoney: 6.1,
    totalInitialPrice: 20,
  })
})

test('slimLuckinPayload: failures keep code and message; empty success says so', () => {
  assert.deepEqual(slimLuckinPayload({ code: 5001, msg: '门店休息中', success: false, data: null }),
    { code: 5001, msg: '门店休息中' })
  assert.deepEqual(slimLuckinPayload({ code: 0, msg: 'success', success: true, data: null }), { msg: 'success' })
})

test('formatToolCallResult emits compact JSON and prefixes tool errors', () => {
  const text = formatToolCallResult(rpc({ code: 0, msg: 'success', success: true, data: { orderId: 'X1' } }), slimLuckinPayload)
  assert.equal(text, '{"orderId":"X1"}')
  assert.equal(formatToolCallResult(rpc({ code: 1, msg: '库存不足' }, true), slimLuckinPayload),
    'Error: {"code":1,"msg":"库存不足"}')
  // raw=true path: unwrapped but untouched.
  assert.equal(formatToolCallResult(rpc({ a: null }), (payload) => payload), '{"a":null}')
})

test('slimToolList keeps name, description and input schema, minus no-op flags', () => {
  const list = slimToolList({
    jsonrpc: '2.0', id: 2,
    result: {
      tools: [{
        name: 'query-meals', description: '查餐品',
        inputSchema: {
          type: 'object',
          properties: {
            storeCode: { type: 'string' },
            extras: { type: 'object', additionalProperties: { type: 'string' } },
            loose: { type: 'object', additionalProperties: true },
          },
          additionalProperties: false,
          returnDirect: false,
        },
        outputSchema: { type: 'object', properties: { huge: { type: 'array' } } },
      }],
    },
  })
  assert.deepEqual(list, [{
    name: 'query-meals', description: '查餐品',
    inputSchema: {
      type: 'object',
      properties: {
        storeCode: { type: 'string' },
        extras: { type: 'object', additionalProperties: { type: 'string' } },
        loose: { type: 'object' },
      },
      additionalProperties: false,
    },
  }])
})

// McDonald's replies carry a Markdown field guide in content[].text and the
// same data clean in structuredContent.
const mcdRpc = (payload) => ({
  jsonrpc: '2.0',
  id: 2,
  result: {
    content: [{ type: 'text', text: `# API Response Information\n字段说明……\n${JSON.stringify(payload)}` }],
    isError: false,
    structuredContent: payload,
  },
})

test('unwrapToolCall prefers structuredContent over the Markdown copy', () => {
  const payload = { success: true, code: 200, message: '请求成功', data: { orderId: 'M1' } }
  assert.deepEqual(unwrapToolCall(mcdRpc(payload)), { payload, isError: false })
})

test('slimMcdPayload unwraps data, drops trace fields and zero coordinates', () => {
  const text = formatToolCallResult(mcdRpc({
    success: true, code: 200, message: '请求成功', datetime: '2026-10-10 09:05:00', traceId: 'abc',
    data: [{ storeCode: '0001', storeName: '测试餐厅', longitude: 0, latitude: 0, businessStatus: true }],
  }), slimMcdPayload)
  assert.equal(text, '[{"storeCode":"0001","storeName":"测试餐厅","businessStatus":true}]')
  assert.deepEqual(slimMcdPayload({ success: false, code: 600050, message: '收藏餐厅列表为空', traceId: 'x' }),
    { code: 600050, message: '收藏餐厅列表为空' })
})

test('compactMcdMenu folds the menu into code lists and one line per meal', () => {
  const card = { cardId: 'CARD1', cardType: 2 }
  assert.deepEqual(compactMcdMenu({
    categories: [
      { name: '人气\n热卖', meals: [{ code: 'A', tags: ['人气产品'] }, { code: 'B' }] },
      { name: '早餐', meals: [{ code: 'A', tags: ['超值早餐'] }] },
    ],
    meals: {
      A: { name: '测试堡', image: 'https://cdn/a.png', currentPrice: '8.1', originalPrice: '13.5',
        discountType: '随单购早餐卡优惠', withOrder: card, canWithOrder: true },
      B: { name: '测试豆浆', currentPrice: '9.5', originalPrice: '9.5', canWithOrder: false },
    },
  }), {
    categories: { '人气 热卖': 'A,B', 早餐: 'A' },
    meals: {
      A: '测试堡 ¥8.1（原¥13.5，随单购早餐卡优惠，随单购卡#0）[人气产品/超值早餐]',
      B: '测试豆浆 ¥9.5',
    },
    withOrderCards: [card],
  })
  assert.deepEqual(compactMcdMenu({ orderId: 'M1' }), { orderId: 'M1' })
})
