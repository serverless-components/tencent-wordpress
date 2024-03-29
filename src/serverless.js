const { Component } = require('@serverless/core')
const { ApiTypeError, ApiError } = require('tencent-component-toolkit/lib/utils/error')
const { sleep } = require('@ygkit/request')
const { deepClone, generateId, getCodeZipPath, uploadCodeToCos } = require('./utils')
const {
  invokeFaas,
  deployFaas,
  deployServerFaas,
  removeFaas,
  deployApigw,
  removeApigw,
  deployVpc,
  deployByDefaultVpc,
  removeVpc,
  deployCfs,
  removeCfs,
  deployDatabase,
  removeDatabase,
  deployLayer,
  removeLayer,
  deployCdn,
  removeCdn
} = require('./utils/sdk')
const DEFAULT_CONFIGS = require('./config')

class ServerlessComponent extends Component {
  getCredentials() {
    const { tmpSecrets } = this.credentials.tencent

    if (!tmpSecrets || !tmpSecrets.TmpSecretId) {
      throw new ApiTypeError(
        'CREDENTIAL',
        'Cannot get secretId/Key, your account could be sub-account and does not have the access to use SLS_QcsRole, please make sure the role exists first, then visit https://cloud.tencent.com/document/product/1154/43006, follow the instructions to bind the role to your account.'
      )
    }

    return {
      SecretId: tmpSecrets.TmpSecretId,
      SecretKey: tmpSecrets.TmpSecretKey,
      Token: tmpSecrets.Token
    }
  }

  getAppId() {
    return this.credentials.tencent.tmpSecrets.appId
  }

  initialize() {
    this.CONFIGS = deepClone(DEFAULT_CONFIGS)
    this.framework = 'wordpress'
    this.__TmpCredentials = this.getCredentials()
  }

  async deploy(inputs) {
    this.initialize()

    let uuid = null
    if (!this.state.uuid) {
      uuid = generateId()
      this.state.uuid = uuid
    } else {
      ;({ uuid } = this.state)
    }

    const { framework, CONFIGS, __TmpCredentials } = this
    const region = inputs.region || CONFIGS.region
    const zone = inputs.zone || CONFIGS.zone

    console.log(`Deploying ${framework} Application (${uuid})`)

    // 首先判断是否配置了db信息
    // 如使用云上数据库，则判断是指定了vpc
    let hasDbConfig = false
    let { dbMode } = CONFIGS.db
    if (inputs.db) {
      dbMode = 'DEFAULT'
      hasDbConfig = true
      const { netMode } = inputs.db
      if (netMode === 'local' && !inputs.vpc) {
        throw new ApiTypeError(
          'VpcNotSet',
          "Vpc configuration must be set when Db netMode is 'local'"
        )
      }
    }

    // 1. 部署VPC.
    let deployVpcHandler = deployByDefaultVpc
    if (inputs.vpc) {
      inputs.vpc.vpcName = `${CONFIGS.vpc.vpcName}`
      inputs.vpc.subnetName = `${CONFIGS.vpc.subnetName}-${uuid}`
      deployVpcHandler = deployVpc
    } else {
      inputs.vpc = {}
      inputs.vpc.vpcName = `${CONFIGS.vpc.vpcName}-${uuid}`
      inputs.vpc.subnetName = `${CONFIGS.vpc.subnetName}-${uuid}`
    }
    const vpcOutput = await deployVpcHandler({
      instance: this,
      inputs,
      state: this.state.vpc
    })

    inputs.vpc = {
      vpcId: vpcOutput.vpcId,
      subnetId: vpcOutput.subnetId
    }

    inputs.zone = vpcOutput.zone

    this.state.vpc = vpcOutput

    // 2. 部署 cfs
    if (inputs.cfs) {
      inputs.cfs.fsName = `${CONFIGS.cfs.name}-${uuid}`
    } else {
      inputs.cfs = {}
      inputs.cfs.fsName = `${CONFIGS.cfs.name}-${uuid}`
    }
    const cfsOutput = await deployCfs({
      instance: this,
      inputs,
      state: this.state.cfs
    })
    this.state.cfs = cfsOutput

    // 3. 判断部署database
    const dbConfig = {}
    let dbOutput = {}
    if (!hasDbConfig) {
      dbOutput = await deployDatabase({
        instance: this,
        inputs,
        state: this.state.db
      })
      dbOutput.dbBuildInfo = dbMode

      // 数据库配置
      dbConfig.DB_USER = 'root'
      dbConfig.DB_NAME = CONFIGS.database
      dbConfig.DB_PASSWORD = dbOutput.adminPassword
      dbConfig.DB_HOST = dbOutput.connection.ip
      dbConfig.DB_PORT = dbOutput.connection.port
    } else {
      dbOutput.dbBuildInfo = dbMode

      // 数据库配置
      dbConfig.DB_USER = inputs.db.user
      dbConfig.DB_NAME = inputs.db.databaseName
      dbConfig.DB_PASSWORD = inputs.db.password
      dbConfig.DB_HOST = inputs.db.host
      dbConfig.DB_PORT = inputs.db.port

      dbOutput = dbConfig
    }
    this.state.db = dbOutput

    // 4. 部署 wp-init 函数
    // wp-init 函数需要配置 vpc，cfs
    let initFaasInputs = {}
    const defaultInitFaasInputs = {
      ...CONFIGS.wpInitFaas,
      // 覆盖名称
      name: `${CONFIGS.wpInitFaas.name}-${uuid}`,
      environments: [
        {
          key: 'DB_MODE',
          value: dbMode
        },
        {
          key: 'DB_USER',
          value: dbConfig.DB_USER
        },
        {
          key: 'DB_PASSWORD',
          value: dbConfig.DB_PASSWORD
        },
        {
          key: 'DB_HOST',
          value: dbConfig.DB_HOST
        },
        {
          key: 'DB_PORT',
          value: dbConfig.DB_PORT
        },
        {
          key: 'DB_NAME',
          value: dbConfig.DB_NAME
        }
      ]
    }
    if (inputs.faas) {
      initFaasInputs = {
        ...inputs.faas,
        ...defaultInitFaasInputs
      }
    } else {
      initFaasInputs = defaultInitFaasInputs
    }

    const wpInitOutput = await deployFaas({
      instance: this,
      inputs: {
        ...inputs,
        ...{
          faas: initFaasInputs
        },
        cfs: [
          {
            cfsId: cfsOutput.cfsId,
            mountInsId: cfsOutput.cfsId,
            localMountDir: CONFIGS.wpInitFaas.cfsMountDir,
            remoteMountDir: '/'
          }
        ]
      },
      state: this.state.wpInitFaas,
      code: {
        zipPath: CONFIGS.wpInitFaas.zipPath,
        bucket: CONFIGS.bucket,
        object: `${CONFIGS.wpInitFaas.name}-${uuid}.zip`
      }
    })

    this.state.wpInitFaas = wpInitOutput

    // 5. 上传 wordpress 代码到 COS
    const wpCodeZip = await getCodeZipPath({ instance: this, inputs })
    const wpCodes = await uploadCodeToCos({
      region,
      instance: this,
      code: {
        zipPath: wpCodeZip,
        bucket: CONFIGS.bucket,
        object: `wp-source-code-${uuid}.zip`,
        injectShim: true
      }
    })

    // 6. 调用 wp-init 函数，同步函数代码
    console.log(`Start initialize database and wordpress code`)
    const invokeOutput = await invokeFaas({
      instance: this,
      inputs,
      name: wpInitOutput.name,
      namespace: wpInitOutput.namespace,
      parameters: {
        WordPressCosRegion: region,
        WordPressCosBucket: wpCodes.bucket,
        WordPressCosPath: wpCodes.object,

        SecretId: __TmpCredentials.SecretId,
        SecretKey: __TmpCredentials.SecretKey,
        Token: __TmpCredentials.Token
      }
    })

    if (invokeOutput.status !== 'success') {
      throw new ApiError({
        type: 'API_WORDPRESS_SYNC_FAAS_INVOKE_ERROR',
        message: `[INIT ERROR]: ${invokeOutput.reason}`
      })
    } else {
      const dbRetryCount = invokeOutput.syncDbRetryNumber
      console.log(
        `Initialize database wordpress success${
          dbRetryCount > 1 ? `, retry count ${dbRetryCount}` : ''
        }`
      )
      console.log(`Sync wordpress source code success`)
    }

    // 7. 部署 layer
    const layerOutput = await deployLayer({
      instance: this,
      inputs: {
        ...inputs,
        ...{
          layer: {
            name: `${CONFIGS.layer.name}-${uuid}`
          }
        }
      },
      state: this.state.layer,
      code: {
        zipPath: CONFIGS.layer.zipPath,
        bucket: CONFIGS.bucket,
        object: `${CONFIGS.layer.name}-${uuid}.zip`
      }
    })

    // console.log('++++++++ layerOutput', layerOutput)

    this.state.layer = layerOutput

    // 8. 部署 wp-server 函数
    // wp-server 函数需要配置 vpc，cfs，环境变量
    let serverFaasInputs = {}
    const defaultServerFaasConfig = {
      ...CONFIGS.wpServerFaas,
      // 覆盖函数名称
      name: `${CONFIGS.wpServerFaas.name}-${uuid}`,
      environments: [
        {
          key: 'DB_MODE',
          value: dbMode
        },
        {
          key: 'DB_NAME',
          value: dbConfig.DB_NAME
        },
        {
          key: 'DB_USER',
          value: dbConfig.DB_USER
        },
        {
          key: 'DB_PASSWORD',
          value: dbConfig.DB_PASSWORD
        },
        {
          key: 'DB_HOST',
          value: dbConfig.DB_HOST + ':' + dbConfig.DB_PORT.toString()
        },
        {
          key: 'MOUNT_DIR',
          value: CONFIGS.wpServerFaas.wpCodeDir
        }
      ]
    }
    if (inputs.faas) {
      serverFaasInputs = {
        ...inputs.faas,
        ...defaultServerFaasConfig
      }
    } else {
      serverFaasInputs = defaultServerFaasConfig
    }
    const wpServerOutput = await deployServerFaas({
      instance: this,
      inputs: {
        ...inputs,
        ...{
          faas: serverFaasInputs
        },
        // 添加 layer
        layers: [
          {
            name: layerOutput.name,
            version: layerOutput.version
          }
        ],
        // 添加 cfs
        cfs: [
          {
            cfsId: cfsOutput.cfsId,
            mountInsId: cfsOutput.cfsId,
            localMountDir: CONFIGS.wpServerFaas.cfsMountDir,
            remoteMountDir: '/'
          }
        ]
      },
      state: this.state.wpServerFaas,
      code: {
        zipPath: '',
        bucket: wpCodes.bucket,
        object: wpCodes.object
      }
    })

    this.state.wpServerFaas = wpServerOutput

    // 9. 创建 API 网关
    if (inputs.apigw) {
      inputs.apigw.name = `${CONFIGS.apigw.name}_${uuid}`
      inputs.apigw.faas = {
        name: wpServerOutput.name,
        namespace: wpServerOutput.namespace,
        functionType: 'web'
      }
    } else {
      inputs.apigw = {}
      inputs.apigw.name = `${CONFIGS.apigw.name}_${uuid}`
      inputs.apigw.faas = {
        name: wpServerOutput.name,
        namespace: wpServerOutput.namespace,
        functionType: 'web'
      }
    }
    const apigwOutput = await deployApigw({
      instance: this,
      state: this.state.apigw,
      inputs
    })

    // console.log('++++++++ apigwOutput', apigwOutput)

    this.state.apigw = apigwOutput

    const outputs = {
      region,
      zone,
      vpc: vpcOutput,
      cfs: cfsOutput,
      db: dbOutput,
      apigw: apigwOutput,
      layer: layerOutput,
      wpInitFaas: wpInitOutput,
      wpServerFaas: wpServerOutput
    }

    if (inputs.cdn) {
      const cdnOutput = await deployCdn({
        instance: this,
        state: this.state.apigw,
        inputs,
        origin: apigwOutput.domain
      })

      console.log('cdnOutput', cdnOutput)
      this.state.cdn = cdnOutput

      outputs.cdn = cdnOutput
    }

    // 这里三个单独配置，是为了支持在线调试和实时日志
    this.state.region = region
    // 配置调试函数为 wp-server，因为它是真正 wordpress 服务函数
    this.state.lambdaArn = wpServerOutput.name
    this.state.namespace = wpServerOutput.namespace

    await this.save()

    return outputs
  }

  async remove() {
    this.initialize()
    const { framework, state, CONFIGS } = this
    const { region } = state

    console.log(`Removing ${framework} App`)

    // 并行 删除 wp-init 和 API 网关
    await Promise.all([
      removeFaas({ instance: this, region, state: state.wpInitFaas }),
      removeApigw({ instance: this, region, state: state.apigw })
    ])

    // 删除 wp-server 函数
    await removeFaas({ instance: this, region, state: state.wpServerFaas })

    // 并行 删除 层、文件系统
    // 以上资源删除结束等待3s，以防后端异步逻辑未同步
    await sleep(3000)
    await Promise.all([
      removeLayer({ instance: this, region, state: state.layer }),
      removeCfs({ instance: this, region, state: state.cfs })
    ])

    // 判读是否为TDSQL-C数据库
    // 是则执行删除
    if (
      this.state.db &&
      this.state.db.dbBuildInfo &&
      this.state.db.dbBuildInfo === CONFIGS.db.dbMode
    ) {
      await removeDatabase({ instance: this, region, state: state.db })
    }

    // 删除 VPC
    // 由于以上资源均依赖 VPC，所以需要最后删除
    // 以上资源删除结束等待3s，以防后端异步逻辑未同步
    await sleep(3000)
    // 只有非默认 vpc 才执行删除
    if (this.state.vpc && !this.state.vpc.isDefault) {
      await removeVpc({ instance: this, region, state: state.vpc })
    }

    if (state.cdn) {
      await removeCdn({ instance: this, region, state: state.cdn })
    }

    this.state = {}

    return {}
  }
}

module.exports = ServerlessComponent
