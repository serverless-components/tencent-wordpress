const path = require('path')

function join(p) {
  return path.join(__dirname, p)
}

const CONFIGS = {
  region: 'ap-guangzhou',
  zone: 'ap-guangzhou-4',

  description: 'Created by Serverless Component',

  shimPath: path.join(__dirname, '_shims'),

  templateUrl:
    'https://serverless-templates-1300862921.cos.ap-beijing.myqcloud.com/wordpress-demo.zip',

  bucket: 'wordpress-serverless-code',

  database: 'wordpress',

  // cdn 配置
  cdn: {
    autoRefresh: true,
    followRedirect: {
      switch: 'on'
    },
    forceRedirect: {
      switch: 'on',
      redirectType: 'https',
      redirectStatusCode: 301
    },
    https: {
      switch: 'on',
      http2: 'on'
    }
  },

  // vpc 配置
  vpc: {
    vpcName: 'wp-vpc',
    subnetName: 'wp-subnet',

    cidrBlock: '10.0.0.0/16',
    enableMulticast: 'FALSE',
    enableSubnetBroadcast: 'FALSE'
  },

  // cfs 配置
  cfs: {
    name: 'wp-cfs',
    netInterface: 'VPC',
    storageType: 'SD',
    pGroupId: 'pgroupbasic',
    protocol: 'NFS'
  },

  // layer 配置
  layer: {
    zipPath: join('fixtures/layer/wp-layer.zip'),
    name: 'wp-layer',
    runtimes: ['Php7']
  },

  // wp-init 函数配置
  wpInitFaas: {
    zipPath: join('fixtures/faas/wp-init.zip'),
    name: 'wp-init',
    type: 'Event',
    runtime: 'Nodejs12.16',
    handler: 'sl_handler.handler',
    cfsMountDir: '/mnt',
    memorySize: 512,
    timeout: 120
  },

  // wp-server 函数配置
  wpServerFaas: {
    zipPath: join('fixtures/faas/wp-server.zip'),
    name: 'wp-server',
    type: 'web',
    runtime: 'Php7',
    cfsMountDir: '/mnt',
    wpCodeDir: '/mnt/wp-content',
    memorySize: 1024,
    timeout: 900
  },

  // 函数公共配置
  faas: {
    timeout: 10,
    memorySize: 128,
    namespace: 'default',
    runtime: 'Php7'
  },

  // API 网关配置
  apigw: {
    isDisabled: false,
    name: 'wp_apigw',
    cors: true,
    timeout: 910,
    qualifier: '$DEFAULT',
    protocols: ['https'],
    environment: 'release'
  },

  // 数据库配置
  db: {
    projectId: 0,
    dbVersion: '5.7',
    dbType: 'MYSQL',
    port: 3306,
    cpu: 1,
    memory: 1,
    storageLimit: 1000,
    instanceCount: 1,
    payMode: 0,
    dbMode: 'SERVERLESS',
    minCpu: 0.25,
    maxCpu: 0.5,
    autoPause: 'yes',
    autoPauseDelay: 600 // default 1h
  },

  // COS 桶配置
  cos: {
    lifecycle: [
      {
        status: 'Enabled',
        id: 'deleteObject',
        filter: '',
        expiration: { days: '10' },
        abortIncompleteMultipartUpload: { daysAfterInitiation: '10' }
      }
    ]
  },

  cdn: {
    autoRefresh: true,
    forceRedirect: {
      switch: 'on',
      redirectType: 'https',
      redirectStatusCode: 301
    },
    https: {
      switch: 'on',
      http2: 'on'
    }
  }
}

module.exports = CONFIGS
