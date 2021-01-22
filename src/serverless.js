const { Component } = require('@serverless/core')
const { TypeError, ApiError } = require('tencent-component-toolkit/src/utils/error')
const { sleep } = require('@ygkit/request')
const { getTimestamp, getCodeZipPath, uploadCodeToCos } = require('./utils')
const {
  invokeFaas,
  deployFaas,
  removeFaas,
  deployApigw,
  removeApigw,
  deployVpc,
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
      throw new TypeError(
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
    this.CONFIGS = DEFAULT_CONFIGS
    this.framework = 'wordpress'
    this.__TmpCredentials = this.getCredentials()
  }

  async deploy(inputs) {
    this.initialize()

    const { framework, CONFIGS, __TmpCredentials } = this
    const region = inputs.region || CONFIGS.region

    console.log(`Deploying ${framework} Application`)

    // 1. 部署VPC
    const vpcOutput = await deployVpc({ instance: this, inputs, state: this.state.vpc })

    inputs.vpc = {
      vpcId: vpcOutput.vpcId,
      subnetId: vpcOutput.subnetId
    }

    this.state.vpc = vpcOutput

    // 2. 部署 cfs 和 database
    // 此处并行部署为了优化部署时间
    const [cfsOutput, dbOutput] = await Promise.all([
      deployCfs({
        instance: this,
        inputs,
        state: this.state.cfs
      }),
      deployDatabase({
        instance: this,
        inputs,
        state: this.state.db
      })
    ])
    this.state.cfs = cfsOutput
    this.state.db = dbOutput

    // console.log('++++++++ dbOutput', dbOutput)

    // 数据库配置
    const dbConfig = {
      DB_USER: 'root',
      DB_NAME: CONFIGS.database,
      DB_PASSWORD: dbOutput.adminPassword,
      DB_HOST: dbOutput.connection.ip,
      DB_PORT: dbOutput.connection.port
    }

    // 3. 部署 wp-init 函数
    // wp-init 函数需要配置 vpc，cfs
    const wpInitOutput = await deployFaas({
      instance: this,
      inputs: {
        ...inputs,
        ...{
          faas: {
            ...CONFIGS.wpInitFaas,
            environments: [
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
                key: 'DB_NAME',
                value: dbConfig.DB_NAME
              }
            ]
          }
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
        object: `${CONFIGS.wpInitFaas.name}.zip`
      }
    })

    this.state.wpInitFaas = wpInitOutput

    // 4. 上传 wordpress 代码到 COS
    const wpCodeZip = await getCodeZipPath({ instance: this, inputs })
    const wpCodes = await uploadCodeToCos({
      region,
      instance: this,
      code: {
        zipPath: wpCodeZip,
        bucket: CONFIGS.bucket,
        object: `wp-source-code.${getTimestamp()}.zip`,
        // object: `wp-source-code.zip`,
        injectShim: true
      }
    })

    // 5. 调用 wp-init 函数，同步函数代码
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
        message: invokeOutput.reason
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

    // 6. 部署 layer
    const layerOutput = await deployLayer({
      instance: this,
      inputs,
      state: this.state.layer,
      code: {
        zipPath: CONFIGS.layer.zipPath,
        bucket: CONFIGS.bucket,
        object: `${CONFIGS.layer.name}.zip`
      }
    })

    // console.log('++++++++ layerOutput', layerOutput)

    this.state.layer = layerOutput

    // 7. 部署 wp-server 函数
    // wp-server 函数需要配置 vpc，cfs，环境变量
    const wpServerOutput = await deployFaas({
      instance: this,
      inputs: {
        ...{
          faas: CONFIGS.faas
        },
        ...inputs,
        ...{
          faas: {
            ...CONFIGS.wpServerFaas,
            environments: [
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
                value: dbConfig.DB_HOST
              },
              {
                key: 'MOUNT_DIR',
                value: CONFIGS.wpServerFaas.wpCodeDir
              },
              {
                key: 'HANDLER',
                value: CONFIGS.wpServerFaas.appHandler
              }
            ]
          }
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
        zipPath: CONFIGS.wpServerFaas.zipPath,
        bucket: CONFIGS.bucket,
        object: `${CONFIGS.wpServerFaas.name}.zip`
      }
    })

    this.state.wpServerFaas = wpServerOutput

    // 8. 创建 API 网关
    const apigwOutput = await deployApigw({
      instance: this,
      state: this.state.apigw,
      inputs: {
        ...inputs,
        ...{
          apigw: {
            faas: {
              name: wpServerOutput.name,
              namespace: wpServerOutput.namespace
            }
          }
        }
      }
    })

    // console.log('++++++++ apigwOutput', apigwOutput)

    this.state.apigw = apigwOutput

    const outputs = {
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
    const { framework, state } = this
    const { region } = state

    console.log(`Removing ${framework} App`)

    // 并行 删除 wp-init 和 API 网关
    await Promise.all([
      removeFaas({ instance: this, region, state: state.wpInitFaas }),
      removeApigw({ instance: this, region, state: state.apigw })
    ])

    // 删除 wp-server 函数
    await removeFaas({ instance: this, region, state: state.wpServerFaas })

    // 并行 删除 层、文件系统 和 数据库
    await Promise.all([
      removeLayer({ instance: this, region, state: state.layer }),
      removeCfs({ instance: this, region, state: state.cfs }),
      removeDatabase({ instance: this, region, state: state.db })
    ])

    // 删除 VPC
    // 由于以上资源均依赖 VPC，所以需要最后删除
    // 以上资源删除结束等待5s，以防后端异步逻辑未同步
    await sleep(5000)
    await removeVpc({ instance: this, region, state: state.vpc })

    if (state.cdn) {
      await removeCdn({ instance: this, region, state: state.cdn })
    }

    this.state = {}

    return {}
  }
}

module.exports = ServerlessComponent
