# 配置文档

## 全部配置

```yml
# serverless.yml

org: orgDemo # (可选) 用于记录组织信息，默认值为您的腾讯云账户 appid，必须为字符串
app: appDemo # (可选) 用于记录组织信息. 默认与name相同，必须为字符串
stage: dev # (可选) 用于区分环境信息，默认值是 dev

component: wordpress # (必选) 组件名称，在该实例中为wordpress
name: wordpressDemo # 必选) 组件实例名称.

inputs:
  region: ap-shanghai # 云函数所在区域
  zone: ap-shanghai-2
  src:
    # 指定 wordpress 源码目录
    src: ./ # 本地需要打包的文件目录
    exclude: # 被排除的文件或目录
      - .env
  tags: # 标签配置
    - key: slstest
      value: slstest
  faas: # 函数配置相关
    memorySize: 1024 # 内存大小，单位MB
  apigw: #  api网关配置
    id: service-xxx # api网关服务ID
    environment: test
    customDomains: # 自定义域名绑定
      - domain: abc.com # 待绑定的自定义的域名
        certId: abcdefg # 待绑定自定义域名的证书唯一 ID
        customMap: true # 是否自定义路径
        pathMap:
          - path: /
            environment: release
        protocols: # 绑定自定义域名的协议类型，默认与服务的前端协议一致。
          - http
          - https
  vpc: # 私有网络配置
    vpcId: vpc-xxxx # 私有网络的Id
    subnetId: subnet-xxxx # 子网ID
  cfs:
    cfsId: cls-xxx
  db:
    clusterId: cluster-xxx
    dbMode: SERVERLESS
```

> 注意：`vpc`、`cfs`、`db` 三个配置的支持，是为了方便用户复用自己已有的云端资源，通常可以不用配置。`faas` 和 `apigw` 两个参数通常也可以不用配置，如果需要指定特定相关参数，比如函数的内存大小，API 网关自定义域名等，可以自定义配置。

## 配置描述

主要的参数

| 参数名称 | 必选 |            类型             |     默认值      | 描述                                                       |
| -------- | :--: | :-------------------------: | :-------------: | :--------------------------------------------------------- |
| src      |  否  |   [Src](#Src) 或者 string   |                 | wordpress 代码目录，如果不指定，会自动基于云端模板代码部署 |
| region   |  否  |                             |  `ap-shanghai`  | 项目部署所在区域                                           |
| zone     |  否  |                             | `ap-shanghai-2` | 分区                                                       |
| tags     |  否  |        [Tag](#Tag)[]        |                 | 标签配置                                                   |
| faas     |  否  |  [FaasConfig](#FaasConfig)  |                 | 函数配置                                                   |
| apigw    |  否  | [ApigwConfig](#ApigwConfig) |                 | API 网关配置                                               |
| vpc      |  否  |         [Vpc](#Vpc)         |                 | 私有网络配置                                               |
| cfs      |  否  |         [Cfs](#Cfs)         |                 | 文件存储配置                                               |
| db       |  否  |          [Db](#Db)          |                 | TDSQL-C serverless 数据库配置                              |

> 注意：由于 Serverless Mysql 数据库 当前支持可用区为：`ap-guangzhou-4`, `ap-shanghai-2`, `ap-beijing-3`, `ap-nanjing-1`，所以本组件也只支持这四个分区。

## Src

执行目录

| 参数名称 | 必选 |   类型   | 默认值 | 描述                                       |
| -------- | :--: | :------: | :----: | :----------------------------------------- |
| src      |  否  |  string  |        | 代码路径。与 obejct 不能同时存在。         |
| exclude  |  否  | string[] |        | 不包含的文件或路径, 遵守 [glob 语法][glob] |
| bucket   |  否  |  string  |        | bucket 名称。                              |
| obejct   |  否  |  string  |        | 部署的代码在存储桶中的路径。               |

> **注意**：如果配置了 src，表示部署 src 的代码并压缩成 zip 后上传到 bucket-appid 对应的存储桶中；如果配置了 obejct，表示获取 bucket-appid 对应存储桶中 obejct 对应的代码进行部署。

比如需要忽略项目的 `node_modules` 目录，可以配置如下：

```yaml
exclude:
  - 'node_modules/**'
```

### Tag

标签配置

| 参数名称 | 必选 |  类型  | 默认值 | 描述   |
| -------- | :--: | :----: | :----: | :----- |
| key      |  是  | string |        | 标签键 |
| value    |  是  | string |        | 标签值 |

### FaasConfig

函数配置，参考: https://cloud.tencent.com/document/product/583/18586

| 参数名称   | 必选 |  类型  | 默认值 | 描述                                                               |
| ---------- | :--: | :----: | :----: | :----------------------------------------------------------------- |
| memorySize |  否  | number | `1024` | 函数运行时内存大小，可选范围 64、128MB-3072MB，并且以 128MB 为阶梯 |

### ApigwConfig

API 网关配置

| 参数名称      | 必选 | 类型                            | 默认值    | 描述                                                   |
| ------------- | :--: | :------------------------------ | :-------- | :----------------------------------------------------- |
| id            |  否  |                                 |           | API 网关服务 ID,如果存在将使用这个 API 网关服务        |
| environment   |  否  | string                          | `release` | 发布环境. 目前支持三种发布环境: test、prepub、release. |
| customDomains |  否  | [CustomDomain](#CustomDomain)[] |           | 自定义 API 域名配置                                    |

##### CustomDomain

自定义域名配置，相关文档: https://cloud.tencent.com/document/product/628/14906

| 参数名称  | 必选 |         类型          | 默认值  | 描述                                                                        |
| --------- | :--: | :-------------------: | :-----: | :-------------------------------------------------------------------------- |
| domain    |  是  |        string         |         | 待绑定的自定义的域名。                                                      |
| certId    |  否  |        string         |         | 待绑定自定义域名的证书唯一 ID，如果设置了 type 为 `https`，则为必选         |
| customMap |  否  |        string         | `false` | 是否自定义路径映射。为 `true` 时，表示自定义路径映射，此时 `pathMap` 必填。 |
| pathMap   |  否  | [PathMap](#PathMap)[] |  `[]`   | 自定义路径映射的路径。                                                      |
| protocol  |  否  |       string[]        |         | 绑定自定义域名的协议类型，默认与服务的前端协议一致。                        |

#### PathMap

自定义路径映射

| 参数名称    | 必选 | 类型   | Description    |
| ----------- | :--: | :----- | :------------- |
| path        |  是  | string | 自定义映射路径 |
| environment |  是  | string | 自定义映射环境 |

> 使用自定义映射时，可一次仅映射一个 path 到一个环境，也可映射多个 path 到多个环境。并且一旦使用自定义映射，原本的默认映射规则不再生效，只有自定义映射路径生效。

### Vpc

VPC - 私有网络配置

| 参数名称 | 类型   | 描述    |
| -------- | ------ | :------ |
| vpcId    | string | VPC ID  |
| subnetId | string | 子网 ID |

### Cfs

CFS - 文件存储配置

| 参数名称 | 类型   | 描述   |
| -------- | ------ | :----- |
| cfsId    | string | CFS ID |

### Db

TDSQL-C serverless 版本配置，如果要复用已有的数据库，可以到 https://console.cloud.tencent.com/cynosdb 查看已经存在的 Serverless TDSQL-C 数据库的集群 ID

| 参数名称  | 类型   | 描述                                                                                      |
| --------- | ------ | :---------------------------------------------------------------------------------------- |
| clusterId | string | 集群 ID                                                                                   |
| dbMode    | string | 数据库类型，默认为 `SERVERLESS` 类型，如果想创建正常的按量计费数据库，可以配置为 `NORMAL` |

<!-- links -->

[glob]: https://github.com/isaacs/node-glob
[scf-config]: https://github.com/serverless-components/tencent-scf/tree/master/docs/configure.md
