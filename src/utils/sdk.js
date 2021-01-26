const { Scf, Apigw, Cos, Cdn, Vpc, Cynosdb, Cfs, Layer } = require('tencent-component-toolkit')
const {
  removeAppid,
  uploadCodeToCos,
  getDefaultProtocol,
  getDefaultFunctionName,
  deepClone,
  initializeStaticCosInputs,
  initializeStaticinputCdn
} = require('./index')

async function deployFaas({ instance, inputs, code, state = {} }) {
  const { __TmpCredentials, CONFIGS } = instance
  const region = inputs.region || CONFIGS.region

  const scf = new Scf(__TmpCredentials, region)
  const inputFaas = inputs.faas || {}
  const DEFAULT_CONFIGS = CONFIGS.faas

  const { bucket, object } = await uploadCodeToCos({ instance, region, code })
  const appId = instance.getAppId()

  const sdkInput = {
    region: region,
    name: inputFaas.name || state.name || getDefaultFunctionName('wp'),
    code: {
      // TODO: 此处为了兼容后端服务，删除掉 -<appid> 后缀，实际 COS 桶名称应该是携带该后缀的
      bucket: removeAppid(bucket, appId),
      object
    },

    // 依赖 layer
    layers: inputs.layers || [],

    // 依赖 CFS
    cfs: inputs.cfs || [],

    // 依赖 vpc
    vpcConfig: inputs.vpc,

    // 函数特定配置
    runtime: inputFaas.runtime || DEFAULT_CONFIGS.runtime,
    handler: inputFaas.handler || DEFAULT_CONFIGS.handler,

    // 支持用户配置
    role: inputFaas.role || '',
    description: inputFaas.description || CONFIGS.description,
    namespace: inputFaas.namespace || DEFAULT_CONFIGS.namespace,
    timeout: inputFaas.timeout || DEFAULT_CONFIGS.timeout,
    initTimeout: inputFaas.initTimeout || DEFAULT_CONFIGS.initTimeout,
    memorySize: inputFaas.memorySize || DEFAULT_CONFIGS.memorySize,
    environment: {
      variables: {
        SERVERLESS: '1'
      }
    }
  }

  // 配置环境变量
  if (inputFaas.environments) {
    inputFaas.environments.forEach((item) => {
      sdkInput.environment.variables[item.key] = item.value
    })
  }

  // 配置标签
  if (inputFaas.tags) {
    const tags = deepClone(inputFaas.tags)
    sdkInput.tags = {}
    tags.forEach((item) => {
      sdkInput.tags[item.key] = item.value
    })
  }

  function formatOutputs(outputs) {
    const result = {
      name: outputs.FunctionName,
      runtime: outputs.Runtime,
      namespace: outputs.Namespace,
      memorySize: outputs.MemorySize
    }

    if (outputs.Layers && outputs.Layers.length > 0) {
      result.layers = outputs.Layers.map((item) => ({
        name: item.LayerName,
        version: item.LayerVersion
      }))
    }

    return result
  }

  const outputs = await scf.deploy(deepClone(sdkInput))

  return formatOutputs(outputs)
}

async function removeFaas({ instance, region, state }) {
  const { __TmpCredentials } = instance
  const faasName = state.name
  if (faasName) {
    const scf = new Scf(__TmpCredentials, region)
    await scf.remove({
      functionName: faasName,
      namespace: state.namespace
    })
  }
  return {}
}

async function invokeFaas({ instance, inputs, name, namespace, parameters }) {
  const { __TmpCredentials, CONFIGS } = instance
  const region = inputs.region || CONFIGS.region

  const scf = new Scf(__TmpCredentials, region)
  // console.log('________', parameters)
  const { Result } = await scf.invoke({
    functionName: name,
    namespace,
    clientContext: parameters
  })

  try {
    return JSON.parse(Result.RetMsg)
  } catch (e) {
    return {}
  }
}

async function deployApigw({ instance, inputs, state = {} }) {
  if (inputs.isDisabled) {
    return {}
  }

  const { __TmpCredentials, CONFIGS } = instance
  const region = inputs.region || CONFIGS.region
  const inputApigw = inputs.apigw || {}
  const DEFAULT_CONFIGS = CONFIGS.apigw

  function formatOutputs(outputs) {
    const result = {
      created: outputs.created,
      url: `${getDefaultProtocol(outputs.protocols)}://${outputs.subDomain}/${outputs.environment}${
        outputs.apiList[0].path
      }`,
      id: outputs.serviceId,
      domain: outputs.subDomain,
      environment: outputs.environment,
      apis: outputs.apiList
    }

    if (outputs.customDomains) {
      result.customDomains = outputs.customDomains
    }
    return result
  }

  const apigw = new Apigw(__TmpCredentials, region)

  const sdkInput = Object.assign(inputApigw, {
    isDisabled: inputApigw.isDisabled === true,
    protocols: inputApigw.protocols || DEFAULT_CONFIGS.protocols,
    environment: inputApigw.environment || DEFAULT_CONFIGS.environment,
    serviceId: inputApigw.id || (state && state.id),
    serviceName: inputApigw.name || DEFAULT_CONFIGS.name,
    serviceDesc: inputApigw.description || CONFIGS.description,
    endpoints: [
      {
        path: '/',
        apiName: 'wp_api',
        method: 'ANY',
        enableCORS: inputApigw.cors === false ? false : true,
        serviceTimeout: inputApigw.timeout || DEFAULT_CONFIGS.timeout,
        isBase64Encoded: true,
        function: {
          isIntegratedResponse: true,
          functionQualifier: inputApigw.qualifier || DEFAULT_CONFIGS.qualifier,

          // 从部署的 wp-server 函数获取信息
          functionName: inputApigw.faas.name,
          functionNamespace: inputApigw.faas.namespace
        }
      }
    ],
    customDomains: (inputApigw.customDomains || []).map((item) => {
      return {
        domain: item.domain,
        certificateId: item.certId,
        isDefaultMapping: !item.customMap,
        pathMappingSet: item.pathMap,
        protocols: item.protocols
      }
    }),
    oldState: {
      created: state.created,
      apiList: state.apis || [],
      customDomains: state.customDomains || []
    }
  })

  const apigwOutput = await apigw.deploy(deepClone(sdkInput))

  return formatOutputs(apigwOutput)
}

async function removeApigw({ instance, region, state }) {
  const { __TmpCredentials } = instance
  const apigw = new Apigw(__TmpCredentials, region)
  // if disable apigw, no need to remove
  if (state.isDisabled !== true) {
    const serviceId = state.id
    if (serviceId) {
      await apigw.remove({
        created: state.created,
        serviceId: serviceId,
        environment: state.environment,
        apiList: state.apis,
        customDomains: state.customDomains
      })
    }
  }
  return {}
}

// deploy static to cos, and setup cdn
async function deployStatic({ instance, credentials, inputs, code }) {
  const { CONFIGS, framework } = instance
  const region = inputs.region || CONFIGS.region
  const appId = instance.getAppId()
  const deployStaticOutpus = {}

  if (code.zipPath) {
    console.log(`Deploy static for ${framework} application`)
    // 1. deploy to cos
    const { staticCosInputs, bucket } = await initializeStaticCosInputs({
      instance,
      inputs,
      appId,
      codeZipPath: code.zipPath
    })

    const cos = new Cos(credentials, region)
    const cosOutput = {
      region
    }
    // flush bucket
    if (inputs.cos.replace) {
      await cos.flushBucketFiles(bucket)
    }
    for (let i = 0; i < staticCosInputs.length; i++) {
      const curInputs = staticCosInputs[i]
      console.log(`Starting deploy directory ${curInputs.src} to cos bucket ${curInputs.bucket}`)
      const deployRes = await cos.deploy(curInputs)
      cosOutput.origin = `${curInputs.bucket}.cos.${region}.myqcloud.com`
      cosOutput.bucket = deployRes.bucket
      cosOutput.url = `https://${curInputs.bucket}.cos.${region}.myqcloud.com`
      console.log(`Deploy directory ${curInputs.src} to cos bucket ${curInputs.bucket} success`)
    }
    deployStaticOutpus.cos = cosOutput

    // 2. deploy cdn
    if (inputs.cdn) {
      const cdn = new Cdn(credentials)
      const inputCdn = await initializeStaticinputCdn({
        instance,
        inputs,
        origin: cosOutput.cosOrigin
      })
      console.log(`Starting deploy cdn ${inputCdn.domain}`)
      const cdnDeployRes = await cdn.deploy(inputCdn)
      const protocol = inputCdn.https ? 'https' : 'http'
      const cdnOutput = {
        domain: cdnDeployRes.domain,
        url: `${protocol}://${cdnDeployRes.domain}`,
        cname: cdnDeployRes.cname
      }
      deployStaticOutpus.cdn = cdnOutput

      console.log(`Deploy cdn ${inputCdn.domain} success`)
    }

    console.log(`Deployed static for ${framework} application successfully`)

    return deployStaticOutpus
  }

  return null
}

async function removeStatic({ instance, region, state }) {
  const { __TmpCredentials } = instance
  if (state) {
    console.log(`Removing static config`)
    // 1. remove cos
    if (state.cos) {
      const cos = new Cos(__TmpCredentials, region)
      await cos.remove(state.cos)
    }
    // 2. remove cdn
    if (state.cdn) {
      const cdn = new Cdn(__TmpCredentials)
      try {
        await cdn.remove(state.cdn)
      } catch (e) {
        // no op
      }
    }
    console.log(`Remove static config success`)
  }
}

async function deployVpc({ instance, inputs, state = {} }) {
  const { __TmpCredentials, CONFIGS } = instance
  const region = inputs.region || CONFIGS.region
  const zone = inputs.zone || CONFIGS.zone

  const inputVpc = inputs.vpc || {}
  const DEFAULT_CONFIGS = CONFIGS.vpc

  // create vpc
  const vpc = new Vpc(__TmpCredentials, region)

  const sdkInput = Object.assign(DEFAULT_CONFIGS, {
    // 通用配置
    region,
    zone,

    // 支持配置 vpcId 和 subnetId，复用已有
    vpcId: inputVpc.vpcId || state.vpcId,
    subnetId: inputVpc.subnetId || state.subnetId,
    // 支持用户配置
    vpcName: inputVpc.vpcName || DEFAULT_CONFIGS.vpcName,
    subnetName: inputVpc.subnetName || DEFAULT_CONFIGS.subnetName
  })
  const vpcOutput = await vpc.deploy(sdkInput)

  return vpcOutput
}

async function removeVpc({ instance, region, state }) {
  const { __TmpCredentials } = instance
  const vpc = new Vpc(__TmpCredentials, region)
  await vpc.remove({
    vpcId: state.vpcId,
    subnetId: state.subnetId
  })

  return {}
}

async function deployDatabase({ instance, inputs, state = {} }) {
  const { __TmpCredentials, CONFIGS } = instance
  const region = inputs.region || CONFIGS.region
  const zone = inputs.zone || CONFIGS.zone

  const cynosdb = new Cynosdb(__TmpCredentials, region)
  const inputDb = inputs.db || {}
  const DEFAULT_CONFIGS = CONFIGS.db

  function formatOutputs(outputs) {
    if (state.adminPassword && !outputs.adminPassword) {
      outputs.adminPassword = state.adminPassword
    }

    return outputs
  }

  const sdkInput = Object.assign(DEFAULT_CONFIGS, {
    // 通用配置
    region,
    zone,

    // 依赖 vpc
    vpcConfig: inputs.vpc,

    // 支持配置 clusterId 进行复用
    clusterId: inputDb.clusterId || state.clusterId,
    // 支持用户配置
    enablePublicAccess: inputDb.enablePublicAccess === true,
    dbMode: inputDb.dbMode || 'SERVERLESS',
    payMode: inputDb.payMode === 1 ? 1 : 0
  })

  const outputs = await cynosdb.deploy(sdkInput)

  return formatOutputs(outputs)
}

async function removeDatabase({ instance, region, state }) {
  const { __TmpCredentials } = instance
  const cynosdb = new Cynosdb(__TmpCredentials, region)

  await cynosdb.remove({
    clusterId: state.clusterId
  })

  return {}
}

async function deployCfs({ instance, inputs, state = {} }) {
  const { __TmpCredentials, CONFIGS } = instance
  const region = inputs.region || CONFIGS.region
  const zone = inputs.zone || CONFIGS.zone

  const cfs = new Cfs(__TmpCredentials, region)
  const inputCfs = inputs.cfs || {}
  const DEFAULT_CONFIGS = CONFIGS.cfs

  function formatOutputs(outputs) {
    outputs.name = outputs.fsName
    outputs.cfsId = outputs.fileSystemId
    outputs.vpc = inputs.vpc
    delete outputs.fsName
    delete outputs.fileSystemId

    return outputs
  }

  const outputs = await cfs.deploy(
    Object.assign(DEFAULT_CONFIGS, {
      // 通用配置
      region,
      zone,

      // 依赖 vpc
      vpc: inputs.vpc,

      // 支持 cfsId 配置，进行复用
      fileSystemId: inputCfs.cfsId || state.cfsId,

      // 支持用户配置
      fsName: inputCfs.fsName || DEFAULT_CONFIGS.name,
      pGroupId: inputCfs.pGroupId || DEFAULT_CONFIGS.pGroupId
    })
  )

  return formatOutputs(outputs)
}

async function removeCfs({ instance, region, state }) {
  const { __TmpCredentials } = instance
  const cfs = new Cfs(__TmpCredentials, region)

  await cfs.remove({
    fsName: state.name,
    fileSystemId: state.cfsId
  })

  return {}
}

async function deployLayer({ instance, inputs, code, state = {} }) {
  const { __TmpCredentials, CONFIGS } = instance
  const region = inputs.region || CONFIGS.region

  const layer = new Layer(__TmpCredentials, region)
  const inputLayer = inputs.layer || {}
  if (state.name && state.version && !inputLayer.force) {
    return state
  }
  const DEFAULT_CONFIGS = CONFIGS.layer
  const { bucket, object } = await uploadCodeToCos({ instance, region, code })
  const appId = instance.getAppId()

  const sdkInput = {
    // TODO: 此处为了兼容后端服务，删除掉 -<appid> 后缀，实际 COS 桶名称应该是携带该后缀的
    bucket: removeAppid(bucket, appId),
    object,
    region,
    name: inputLayer.name || DEFAULT_CONFIGS.name,
    runtimes: DEFAULT_CONFIGS.runtimes,
    description: CONFIGS.description
  }

  const outputs = await layer.deploy(sdkInput)

  return outputs
}

async function removeLayer({ instance, region, state }) {
  const { __TmpCredentials } = instance
  const layer = new Layer(__TmpCredentials, region)

  await layer.remove({
    name: state.name,
    version: state.version
  })

  return {}
}

async function deployCdn({ instance, inputs, state = {}, origin }) {
  const { __TmpCredentials, CONFIGS, framework } = instance
  const cdn = new Cdn(__TmpCredentials)
  const inputCdn = inputs.cdn || {}

  const sdkInputs = {
    async: inputCdn.async === true,
    area: inputCdn.area || 'mainland',
    domain: inputCdn.domain,
    serviceType: 'web',
    origin: {
      origins: [origin],
      originType: 'domain',
      originPullProtocol: 'https',
      serverName: origin
    },
    followRedirect: CONFIGS.cdn.followRedirect,
    autoRefresh: true,
    refreshCdn: {
      flushType: inputCdn.refreshType || 'delete',
      urls: [`http://${inputCdn.domain}`, `https://${inputCdn.domain}`]
    },
    oldState: state,
    cache: {
      simpleCache: {
        cacheRules: [
          {
            cacheType: 'file',
            cacheContents: ['jpg', 'png', 'css', 'js', 'gif', 'svg', 'woff', 'ttf', 'font'],
            // 默认缓存一年
            cacheTime: 31536000
          }
        ],
        followOrigin: 'on',
        ignoreCacheControl: 'off',
        ignoreSetCookie: 'off',
        compareMaxAge: 'off'
      }
    }
  }

  if (inputCdn.https) {
    // using these default configs, for making user's config more simple
    inputCdn.forceRedirect = {
      ...{
        switch: 'on'
      },
      ...(inputCdn.forceRedirect || CONFIGS.cdn.forceRedirect)
    }
    if (!inputCdn.https.certId) {
      throw new TypeError(`PARAMETER_${framework}_HTTPS`, 'https.certId is required')
    }
    inputCdn.https = {
      ...CONFIGS.cdn.https,
      ...{
        http2: 'off',
        certInfo: {
          certId: inputCdn.https.certId
        }
      }
    }
  }

  const outputs = await cdn.deploy(sdkInputs)
  return outputs
}

async function removeCdn({ instance, region, state }) {
  const { __TmpCredentials } = instance
  const cdn = new Cdn(__TmpCredentials, region)

  await cdn.remove({
    domain: state.domain
  })

  return {}
}

module.exports = {
  invokeFaas,
  deployFaas,
  removeFaas,
  deployApigw,
  removeApigw,
  deployStatic,
  removeStatic,
  deployVpc,
  removeVpc,
  deployDatabase,
  removeDatabase,
  deployCfs,
  removeCfs,
  deployLayer,
  removeLayer,
  deployCdn,
  removeCdn
}
