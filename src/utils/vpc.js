const { ApiTypeError } = require('tencent-component-toolkit/lib/utils/error')

/**
 * 自然数级别的区间计算库；也可用于字符串区间（直接使用字符串对比），但此时不支持区间减法。
 * nature number ranges calculate library, also support string ranges without subtraction.
 */
// 点、区对比结果  point vs range compare result
const PR_RESULT = {
  BEFORE: -1, // 1 vs [2,3]
  IN: 1, // 1 vs [1,2]
  AFTER: 2 // 3 vs [1,2]
}
// 区、区对比结果  range vs range compare result
const RR_RESULT = {
  BEFORE: -3, // [1,2] vs [3,4]
  C_BEFORE: -2, // [1,3] vs [2,4]
  CONTAIN: -1, // [1,4] vs [2,3]
  IN: 1, // [2,3] vs [1,4]
  C_AFTER: 2, // [2,4] vs [1,3]
  AFTER: 3 // [3,4] vs [1,2]
}
// 通过点区对比结果快速查区区对比结果，即通过a与[c,d]、b与[c,d]的结果来计算[a,b]与[c,d]的对比结果
// calculate ([a,b] vs [c,d]) result by results of (a vs [c,d]) and (b vs [c,d]),
const RR_MAP = {}

// --- when a before [c,d]
let o = (RR_MAP[PR_RESULT.BEFORE] = {})
// when b before [c,d], [a,b] before [c,d]
o[PR_RESULT.BEFORE] = RR_RESULT.BEFORE
// when b in [c,d], [a,b] before and connect to [c,d]
o[PR_RESULT.IN] = RR_RESULT.C_BEFORE
// when b after [c,d], [a,b] contain [c,d]
o[PR_RESULT.AFTER] = RR_RESULT.CONTAIN

// --- when a in [c,d]
o = RR_MAP[PR_RESULT.IN] = {}
o[PR_RESULT.IN] = RR_RESULT.IN
o[PR_RESULT.AFTER] = RR_RESULT.C_AFTER

// --- when a after [c,d]
o = RR_MAP[PR_RESULT.AFTER] = {}
o[PR_RESULT.AFTER] = RR_RESULT.AFTER

// compare point and range, return PR_RESULT
function comparePR(v, r) {
  return v < r[0] ? PR_RESULT.BEFORE : v <= r[1] ? PR_RESULT.IN : PR_RESULT.AFTER
}
// compare range and range, return RR_RESULT
function compareRR(r1, r2) {
  return RR_MAP[comparePR(r1[0], r2)][comparePR(r1[1], r2)]
}
function isInt(n) {
  return Number(n) === n && n % 1 === 0
}
// 判断两个区间是否连接
// if range1 and range2 are adjacent
function isAdjacentRR(r1, r2) {
  const a = r1[1],
    b = r2[0]
  if (!isInt(a) || !isInt(b)) {
    return false
  }
  return a + 1 === b
}
// 区间相加
// range addition
function addRR(r1, r2) {
  switch (compareRR(r1, r2)) {
    case RR_RESULT.BEFORE:
      return isAdjacentRR(r1, r2) ? [[r1[0], r2[1]]] : [r1, r2]
    case RR_RESULT.IN:
      return [r2]
    case RR_RESULT.AFTER:
      return isAdjacentRR(r2, r1) ? [[r2[0], r1[1]]] : [r2, r1]
    case RR_RESULT.C_BEFORE:
      return [[r1[0], r2[1]]]
    case RR_RESULT.C_AFTER:
      return [[r2[0], r1[1]]]
    case RR_RESULT.CONTAIN:
      return [r1]
  }
}

// 区间相减
// range subtraction
function subRR(r1, r2) {
  switch (compareRR(r1, r2)) {
    case RR_RESULT.BEFORE:
      return [r1]
    case RR_RESULT.IN:
      return []
    case RR_RESULT.AFTER:
      return [r1]
    case RR_RESULT.C_BEFORE:
      return [[r1[0], r2[0] - 1]]
    case RR_RESULT.C_AFTER:
      return [[r2[1] + 1, r1[1]]]
    case RR_RESULT.CONTAIN:
      return [
        [r1[0], r2[0] - 1],
        [r2[1] + 1, r1[1]]
      ]
  }
}

class Ranges {
  constructor(a, b) {
    this.ranges = a instanceof Array ? a : [[a, b]]
    this._connectRange()
  }

  // 连接、组合相连的区间
  // [ [1,2], [3,4], [3,6], [8,9] ]  ->  [ [1,6], [8,9] ]
  _connectRange() {
    const { ranges } = this
    ranges.sort(compareRR)
    let results = [],
      r1 = ranges[0],
      i,
      r2,
      result
    for (i = 1; i < ranges.length; i++) {
      r2 = ranges[i]
      result = addRR(r1, r2)
      results = results.concat(result)
      r1 = results.pop()
    }
    results.push(r1)
    return (this.ranges = results)
  }

  /**
   * 添加区间
   * @param {Array} r1 例如 [1,3]
   */
  add(r1) {
    this.ranges.push(r1)
    this._connectRange()
    return this
  }

  /**
   * 减去区间
   * @param {Array} r2 例如 [1,3]
   */
  sub(r2) {
    if (!isInt(r2[0])) {
      throw new Error('Not support non integer range')
    }
    const { ranges } = this
    let results = [],
      i,
      result,
      r1
    for (i = 0; i < ranges.length; i++) {
      r1 = ranges[i]
      result = subRR(r1, r2)
      results = results.concat(result)
    }
    this.ranges = results
    return this
  }

  /**
   * 判断区间是否有冲突
   * @param {Array} range 例如 [1,3]
   * @returns {boolean}
   */
  isConflict(range) {
    const { ranges } = this
    for (let i = 0; i < ranges.length; i++) {
      switch (compareRR(ranges[i], range)) {
        case RR_RESULT.IN:
        case RR_RESULT.C_BEFORE:
        case RR_RESULT.C_AFTER:
        case RR_RESULT.CONTAIN:
          return true
      }
    }
    return false
  }

  /**
   * 判断点是否在区间内
   * @param {Number|Array} point
   * @returns {boolean}
   */
  isContain(point) {
    const { ranges } = this
    let range
    if (isInt(point)) {
      for (let i = 0; i < ranges.length; i++) {
        if (comparePR(point, ranges[i]) === PR_RESULT.IN) {
          return true
        }
      }
    } else {
      range = point
      for (let i = 0; i < ranges.length; i++) {
        if (compareRR(range, ranges[i]) === RR_RESULT.IN) {
          return true
        }
      }
    }

    return false
  }
}

function ipToUint(e) {
  return (((e = e.split('.'))[0] << 24) | (e[1] << 16) | (e[2] << 8) | e[3]) >>> 0
}

function uintToIp(e) {
  return (e >>> 24) + '.' + ((e >>> 16) & 255) + '.' + ((e >>> 8) & 255) + '.' + (255 & e)
}

function getIpZone(e, t) {
  const n = ipToUint(e)
  return [(n & ((Math.pow(2, t) - 1) << (32 - t))) >>> 0, (n | (Math.pow(2, 32 - t) - 1)) >>> 0]
}

// 检查是否存在 CIDR 冲突
function getAvailableCidr(
  vpcCIDR,
  existSubnetCIDRs // 已绑定的子网的 CIDR
) {
  const [vpcNat, vpcMask] = vpcCIDR.split('/')
  const totalRang = new Ranges([getIpZone(vpcNat, vpcMask)]) // 可用 CIDR 范围
  existSubnetCIDRs.forEach((existCIDR) => {
    // 减去已经使用的 CIDR 范围
    const [subnetNat, subnetMask] = existCIDR.split('/')
    totalRang.sub(getIpZone(subnetNat, subnetMask))
  })

  const [avalableZone] = totalRang.ranges
  if (avalableZone) {
    return `${uintToIp(avalableZone[0])}/${28}`
  }
  throw new ApiTypeError(`GET_AVAILABLE_CIDR`, `Can not get available CIDR for VPC ${vpcCIDR}.`)
}

module.exports = {
  getAvailableCidr
}

// const vpcCidr = '172.17.0.0/16'
// const existCidr = [
//   '172.17.3.0/24',
//   '172.17.2.0/29',
//   '172.17.1.0/24',
//   '172.17.0.0/24',
//   '172.17.2.8/29',
//   '172.17.2.16/29'
// ]

// console.log(getAvailableCidr(vpcCidr, []))
