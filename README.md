**腾讯云 Wordpress 组件** ⎯⎯⎯ 通过使用 [Tencent Serverless Framework](https://github.com/serverless/components/tree/cloud)，基于云上 Serverless 服务（如网关、云函数、Serverless Mysql、CFS 等），实现“0”配置，便捷开发，极速部署你的 Wordpress 应用，Wordpress 组件支持丰富的配置扩展，提供了目前最易用、低成本并且弹性伸缩的 Wordpress 项目开发/托管能力。
<br/>

快速开始：

1. [**安装**](#1-安装)
2. [**创建**](#2-创建)
3. [**部署**](#3-部署)
4. [**配置**](#4-配置)
5. [**查看状态**](#6-查看状态)
6. [**移除**](#7-移除)

更多资源：

- [**架构说明**](#架构说明)
- [**账号配置**](#账号配置)

### 架构

<img src="./docs/architecture.jpg" alt="Serverless Wordpress 架构" width="800">

### 1. 安装

通过 npm 安装最新版本的 Serverless Framework

```bash
$ npm install -g serverless
```

### 2. 创建

通过如下命令和模板链接，快速创建一个 Wordpress 应用：

```bash
$ serverless init wordpress-starter --name example
$ cd example
```

### 3. 部署

在 `serverless.yml` 文件所在的项目根目录，运行以下指令进行部署：

```bash
$ serverless deploy
```

部署时需要进行身份验证，如您的账号未 [登陆](https://cloud.tencent.com/login) 或 [注册](https://cloud.tencent.com/register) 腾讯云，您可以直接通过 `微信` 扫描命令行中的二维码进行授权登陆和注册。

> 注意: 如果希望查看更多部署过程的信息，可以通过`serverless deploy --debug` 命令查看部署过程中的实时日志信息。

部署成功后控制台输出参数介绍请参考 [output 文档](https://github.com/serverless-components/tencent-wordpress/blob/master/docs/output.md)

### 4. 配置

Wordpress 组件支持 0 配置部署，也就是可以直接通过配置文件中的默认值进行部署。但你依然可以修改更多可选配置来进一步开发该 Wordpress 项目。

以下是 Wordpress 组件的 `serverless.yml`配置示例：

```yml
# serverless.yml

app: appDemo
stage: dev
component: wordpress
name: wordpressDemo

inputs:
  src:
    src: ./wordpress
    exclude:
      - .env
```

点此查看[全量配置及配置说明](https://github.com/serverless-components/tencent-wordpress/tree/master/docs/configure.md)

当你根据该配置文件更新配置字段后，再次运行 `serverless deploy` 或者 `serverless` 就可以更新配置到云端。

### 5. 查看状态

在`serverless.yml`文件所在的目录下，通过如下命令查看部署状态：

```
$ serverless info
```

### 6. 移除

在`serverless.yml`文件所在的目录下，通过以下命令移除部署的 Wordpress 服务。移除后该组件会对应删除云上部署时所创建的所有相关资源。

```
$ serverless remove
```

和部署类似，支持通过 `serverless remove --debug` 命令查看移除过程中的实时日志信息。

## 架构说明

Wordpress 组件将在腾讯云账户中使用到如下 Serverless 服务：

- [x] **API 网关** - API 网关将会接收外部请求并且转发到 SCF 云函数中。
- [x] **SCF 云函数** - 云函数将承载 Wordpress.js 应用。
- [x] **CAM 访问控制** - 该组件会创建默认 CAM 角色用于授权访问关联资源。
- [x] **COS 对象存储** - 为确保上传速度和质量，云函数压缩并上传代码时，会默认将代码包存储在特定命名的 COS 桶中。
- [x] **VPC 私有网络** - 腾讯云私有网络。
- [x] **CFS 文件存储** - 腾讯云文件存储。
- [x] **TDSQL-C 数据库** - 腾讯云 Serverless Mysql 数据库。
- [x] **SSL 证书服务** - 如果你在 yaml 文件中配置了 `apigatewayConf.customDomains` 字段，需要做自定义域名绑定并开启 HTTPS 时，也会用到证书管理服务和域名服务。Serverless Framework 会根据已经备案的域名自动申请并配置 SSL 证书。

## 账号配置

当前默认支持 CLI 扫描二维码登录，如您希望配置持久的环境变量/秘钥信息，也可以本地创建 `.env` 文件

```console
$ touch .env # 腾讯云的配置信息
```

在 `.env` 文件中配置腾讯云的 SecretId 和 SecretKey 信息并保存

如果没有腾讯云账号，可以在此[注册新账号](https://cloud.tencent.com/register)。

如果已有腾讯云账号，可以在[API 密钥管理](https://console.cloud.tencent.com/cam/capi)中获取 `SecretId` 和`SecretKey`.

```
# .env
TENCENT_SECRET_ID=123
TENCENT_SECRET_KEY=123
```

## License

MIT License

Copyright (c) 2020 Tencent Cloud, Inc.
