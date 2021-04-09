const path = require('path')
const fs = require('fs')
const { Cos } = require('tencent-component-toolkit')
const download = require('download')
const { ApiTypeError } = require('tencent-component-toolkit/lib/utils/error')
const AdmZip = require('adm-zip')

const generateId = () =>
  Math.random()
    .toString(36)
    .substring(6)

const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj))
}

const typeOf = (obj) => {
  return Object.prototype.toString.call(obj).slice(8, -1)
}

const capitalString = (str) => {
  if (str.length < 2) {
    return str.toUpperCase()
  }

  return `${str[0].toUpperCase()}${str.slice(1)}`
}

const isUndefined = (o) => {
  return o === undefined
}

const getTimestamp = () => {
  return Math.floor(Date.now() / 1000)
}

const getDefaultProtocol = (protocols) => {
  return String(protocols).includes('https') ? 'https' : 'http'
}

const getDefaultFunctionName = (framework) => {
  return `${framework}-${generateId()}`
}

const getDefaultBucketName = (region) => {
  return `serverless-${region}-code`
}

const getDefaultObjectName = (inputs) => {
  return `${inputs.name}-${getTimestamp()}.zip`
}

const getDirFiles = (dirPath) => {
  const targetPath = path.resolve(dirPath)
  const files = fs.readdirSync(targetPath)
  const temp = {}
  files.forEach((file) => {
    temp[file] = path.join(targetPath, file)
  })
  return temp
}

const removeAppid = (str, appid) => {
  const suffix = `-${appid}`
  if (!str || str.indexOf(suffix) === -1) {
    return str
  }
  return str.slice(0, -suffix.length)
}

const getCodeZipPath = async ({ instance, inputs }) => {
  const { CONFIGS, framework } = instance
  // unzip source zip file
  let zipPath
  if (!inputs.src) {
    // add default template
    const downloadPath = `/tmp/${generateId()}`
    const filename = 'template'

    console.log(`Downloading default ${framework} application`)
    try {
      await download(CONFIGS.templateUrl, downloadPath, {
        filename: `${filename}.zip`
      })
    } catch (e) {
      throw new ApiTypeError(`DOWNLOAD_TEMPLATE`, 'Download default template failed.')
    }
    zipPath = `${downloadPath}/${filename}.zip`
  } else {
    zipPath = inputs.src
  }

  return zipPath
}

const getInjection = (instance) => {
  const { CONFIGS } = instance
  const injectFiles = getDirFiles(CONFIGS.shimPath)
  const injectDirs = {}

  return { injectFiles, injectDirs }
}

/**
 * 上传代码到用户 cos
 * @param {Component} instance serverless component 实例
 * @param {object} code 代码配置参数
 * @param {string} region 地域
 */
const uploadCodeToCos = async ({ instance, code, region }) => {
  const { CONFIGS, __TmpCredentials } = instance
  const appId = instance.getAppId()
  const { zipPath, bucket, object: bucketKey, injectShim = false } = code

  const cosBucketName = `${removeAppid(bucket, appId)}-${region}-${appId}`

  console.log(`Code zip path ${zipPath}`)

  const cos = new Cos(__TmpCredentials, region)

  // 1. 尝试创建 bucket
  await cos.deploy({
    force: true,
    bucket: cosBucketName,
    lifecycle: CONFIGS.cos.lifecycle
  })

  // 2. 上传代码到 COS
  console.log(`Getting cos upload url for bucket ${bucket}`)
  const uploadUrl = await cos.getObjectUrl({
    bucket: cosBucketName,
    object: bucketKey,
    method: 'PUT'
  })
  console.log(`Uploading code to bucket ${cosBucketName}`)
  // 是否需要注入垫片代码
  if (injectShim) {
    const { injectFiles, injectDirs } = getInjection(instance)
    await instance.uploadSourceZipToCOS(zipPath, uploadUrl, injectFiles, injectDirs)
  } else {
    await instance.uploadSourceZipToCOS(zipPath, uploadUrl, {}, {})
  }

  console.log(`Upload ${bucketKey} to bucket ${cosBucketName} success`)

  return {
    bucket: cosBucketName,
    object: bucketKey
  }
}

const initializeStaticCosInputs = async ({ instance, inputs, appId, codeZipPath }) => {
  const { CONFIGS, framework } = instance
  try {
    const staticCosInputs = []
    const { cos: cosConfig } = inputs
    const sources = cosConfig.sources || CONFIGS.defaultStatics
    const { bucket } = cosConfig
    // remove user append appid
    const bucketName = removeAppid(bucket, appId)
    const staticPath = `/tmp/${generateId()}`
    const codeZip = new AdmZip(codeZipPath)
    const entries = codeZip.getEntries()

    // traverse sources, generate static directory and deploy to cos
    for (let i = 0; i < sources.length; i++) {
      const curSource = sources[i]
      const entryName = `${curSource.src}`
      let exist = false
      entries.forEach((et) => {
        if (et.entryName.indexOf(entryName) === 0) {
          codeZip.extractEntryTo(et, staticPath, true, true)
          exist = true
        }
      })
      if (exist) {
        const cosInputs = {
          force: true,
          protocol: cosConfig.protocol,
          bucket: `${bucketName}-${appId}`,
          src: `${staticPath}/${entryName}`,
          keyPrefix: curSource.targetDir || '/',
          acl: {
            permissions: 'public-read',
            grantRead: '',
            grantWrite: '',
            grantFullControl: ''
          }
        }

        if (cosConfig.acl) {
          cosInputs.acl = {
            permissions: cosConfig.acl.permissions || 'public-read',
            grantRead: cosConfig.acl.grantRead || '',
            grantWrite: cosConfig.acl.grantWrite || '',
            grantFullControl: cosConfig.acl.grantFullControl || ''
          }
        }

        staticCosInputs.push(cosInputs)
      }
    }
    return {
      bucket: `${bucketName}-${appId}`,
      staticCosInputs
    }
  } catch (e) {
    throw new ApiTypeError(`UTILS_${framework}_initializeStaticCosInputs`, e.message, e.stack)
  }
}

const initializeStaticCdnInputs = async ({ instance, inputs, origin }) => {
  const { CONFIGS, framework } = instance
  try {
    const { cdn: cdnConfig } = inputs
    const cdnInputs = {
      async: true,
      area: cdnConfig.area || 'mainland',
      domain: cdnConfig.domain,
      serviceType: 'web',
      origin: {
        origins: [origin],
        originType: 'cos',
        originPullProtocol: 'https'
      },
      autoRefresh: true,
      ...cdnConfig
    }
    if (cdnConfig.https) {
      // using these default configs, for making user's config more simple
      cdnInputs.forceRedirect = {
        ...{
          switch: 'on'
        },
        ...(cdnConfig.forceRedirect || CONFIGS.cdn.forceRedirect)
      }
      if (!cdnConfig.https.certId) {
        throw new ApiTypeError(`PARAMETER_${framework}_HTTPS`, 'https.certId is required')
      }
      cdnInputs.https = {
        ...CONFIGS.cdn.https,
        ...{
          http2: cdnConfig.https.http2 || 'on',
          certInfo: {
            certId: cdnConfig.https.certId
          }
        }
      }
    }
    if (cdnInputs.autoRefresh) {
      cdnInputs.refreshCdn = {
        flushType: cdnConfig.refreshType || 'delete',
        urls: [`http://${cdnInputs.domain}`, `https://${cdnInputs.domain}`]
      }
    }

    return cdnInputs
  } catch (e) {
    throw new ApiTypeError(`UTILS_${framework}_initializeStaticCdnInputs`, e.message, e.stack)
  }
}

module.exports = {
  typeOf,
  isUndefined,
  deepClone,
  generateId,
  uploadCodeToCos,
  capitalString,
  removeAppid,
  getTimestamp,
  getDefaultProtocol,
  getDefaultFunctionName,
  getDefaultBucketName,
  getDefaultObjectName,
  getCodeZipPath,
  initializeStaticCosInputs,
  initializeStaticCdnInputs
}
